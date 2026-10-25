#!/usr/bin/env bash
# One-time (idempotent) secret + database role bootstrap for an environment created by infra/aws.
#   AWS_REGION=eu-west-2 scripts/deploy/aws-bootstrap.sh staging
# Run from infra/aws's `terraform output` context with AWS credentials for that account.
#
# - Generates DB role passwords, ENCRYPTION_KEY and the Redis AUTH token ONLY if the secret
#   has no value yet. It never rotates: existing ENCRYPTION_KEY values are left untouched
#   (rotation is the docs/operations.md procedure, never this script).
# - Values go to Secrets Manager via 0600 temp files; nothing is echoed or passed on argv.
# - Runs the dbinit ECS task (scripts/db/bootstrap-roles.sql) inside the VPC.
set -euo pipefail
ENV_NAME="${1:?usage: aws-bootstrap.sh <staging|production>}"
NAME="atlas-${ENV_NAME}"
TF_DIR="$(cd "$(dirname "$0")/../../infra/aws" && pwd)"
tfo() { terraform -chdir="$TF_DIR" output -raw "$1"; }

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

has_value() { aws secretsmanager get-secret-value --secret-id "$1" --query 'length(SecretString)' --output text >/dev/null 2>&1; }
put() { # put <secret-id> <file>
  aws secretsmanager put-secret-value --secret-id "$1" --secret-string "file://$2" >/dev/null
  echo "  set $1"
}
gen_if_missing() { # gen_if_missing <secret-id> <command producing the value>
  if has_value "$1"; then echo "  keep $1 (already set)"; return; fi
  eval "$2" | tr -d '\n' > "$TMP/v"
  put "$1" "$TMP/v"
}
read_secret() { aws secretsmanager get-secret-value --secret-id "$1" --query SecretString --output text; }

DB_HOST="$(tfo db_address)"
REDIS_HOST="$(tfo redis_primary_endpoint)"
REDIS_RG="$(tfo redis_replication_group_id)"
CLUSTER="$(tfo cluster_name)"
SUBNETS="$(terraform -chdir="$TF_DIR" output -json private_subnet_ids | tr -d '[] "\n')"
SG="$(tfo app_security_group_id)"

echo "Generated secrets:"
gen_if_missing "$NAME/ATLAS_OWNER_PASSWORD" "openssl rand -hex 32"
gen_if_missing "$NAME/ATLAS_APP_PASSWORD"   "openssl rand -hex 32"
gen_if_missing "$NAME/ENCRYPTION_KEY"       "openssl rand -base64 32"
gen_if_missing "$NAME/EMAIL_WEBHOOK_SECRET" "openssl rand -hex 32"

echo "Connection URLs:"
# Hex passwords need no URL-encoding. RDS enforces TLS (rds.force_ssl).
if ! has_value "$NAME/DATABASE_URL"; then
  printf 'postgresql://atlas_app:%s@%s:5432/atlas?schema=public&sslmode=require' "$(read_secret "$NAME/ATLAS_APP_PASSWORD")" "$DB_HOST" > "$TMP/v"
  put "$NAME/DATABASE_URL" "$TMP/v"
else echo "  keep $NAME/DATABASE_URL"; fi
if ! has_value "$NAME/MIGRATION_DATABASE_URL"; then
  printf 'postgresql://atlas_owner:%s@%s:5432/atlas?schema=public&sslmode=require' "$(read_secret "$NAME/ATLAS_OWNER_PASSWORD")" "$DB_HOST" > "$TMP/v"
  put "$NAME/MIGRATION_DATABASE_URL" "$TMP/v"
else echo "  keep $NAME/MIGRATION_DATABASE_URL"; fi

if ! has_value "$NAME/REDIS_URL"; then
  openssl rand -hex 32 | tr -d '\n' > "$TMP/redis_token"
  # Adds AUTH to the TLS-only replication group. ROTATE accepts both old (none) and new token
  # while clients move over. The token is never echoed, but is briefly on the local aws argv.
  aws elasticache modify-replication-group --replication-group-id "$REDIS_RG" \
    --auth-token "$(cat "$TMP/redis_token")" --auth-token-update-strategy ROTATE --apply-immediately >/dev/null
  echo "  waiting for Redis to apply AUTH token…"
  aws elasticache wait replication-group-available --replication-group-id "$REDIS_RG"
  printf 'rediss://:%s@%s:6379' "$(cat "$TMP/redis_token")" "$REDIS_HOST" > "$TMP/v"
  put "$NAME/REDIS_URL" "$TMP/v"
else echo "  keep $NAME/REDIS_URL"; fi

echo "Database roles (dbinit task):"
TASK_ARN="$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "$(terraform -chdir="$TF_DIR" output -json task_definition_families | python3 -c 'import json,sys;print(json.load(sys.stdin)["dbinit"])')" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"
CODE="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].containers[0].exitCode' --output text)"
if [ "$CODE" != "0" ]; then echo "dbinit failed (exit $CODE); see CloudWatch /atlas/$ENV_NAME/migrate, stream dbinit/*" >&2; exit 1; fi
echo "  roles atlas_owner / atlas_app ready"

cat <<MSG

Done. Still to set by an operator (aws secretsmanager put-secret-value --secret-id <id> --secret-string file://<0600 file>):
  $NAME/POSTMARK_SERVER_TOKEN, $NAME/STRIPE_SECRET_KEY, $NAME/STRIPE_WEBHOOK_SECRET,
  and platform AI keys only if platform AI is intended ($NAME/{GEMINI,OPENAI,ANTHROPIC}_API_KEY).
Then list them in enabled_optional_secrets and re-apply Terraform.
BACK UP $NAME/ENCRYPTION_KEY to offline escrow now (docs/operations.md).
MSG
