# Secret CONTAINERS only. Values are written by scripts/deploy/aws-bootstrap.sh (generated
# secrets) or by an operator with `aws secretsmanager put-secret-value` (third-party keys).
# Nothing here puts a secret value into Terraform state.
locals {
  app_secrets = toset([
    "DATABASE_URL",           # atlas_app (runtime, RLS enforced)
    "MIGRATION_DATABASE_URL", # atlas_owner (migration task only)
    "REDIS_URL",
    "ENCRYPTION_KEY", # back up; rotate only via docs/operations.md procedure
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "POSTMARK_SERVER_TOKEN",
    "EMAIL_WEBHOOK_SECRET",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ])
  # Never given to web/worker: only the migration task gets the owner URL.
  runtime_secrets   = setsubtract(local.app_secrets, ["MIGRATION_DATABASE_URL"])
  migration_secrets = toset(["DATABASE_URL", "MIGRATION_DATABASE_URL", "ENCRYPTION_KEY", "REDIS_URL"])
}

resource "aws_secretsmanager_secret" "app" {
  for_each                = local.app_secrets
  name                    = "${local.name}/${each.key}"
  recovery_window_in_days = local.is_prod ? 30 : 7
}
