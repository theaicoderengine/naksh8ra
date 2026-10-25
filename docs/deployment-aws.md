# AWS deployment (infra/aws) — optional

> Not part of the Hostinger deployment ([deployment-hostinger.md](deployment-hostinger.md)). Kept for a future move to containers; nothing here runs unless the AWS workflow is started manually.

**Status:** the Terraform in `infra/aws` passes `terraform validate` and `terraform fmt -check`. It has **never been applied**: no AWS account was available when it was written. The pipeline (`.github/workflows/deploy.yml`) has never run. Treat the first apply on staging as the real test.

## Architecture

| Need | Service |
|---|---|
| Next.js web (≥2 tasks in production) | ECS Fargate behind an ALB. ACM certificate, TLS 1.3 policy, HTTP→HTTPS 301 |
| Persistent worker (BullMQ, scheduler, `ai.reservations.sweep`) | ECS Fargate service `worker` (tooling image), health on 3001 |
| PostgreSQL 16 with enforced RLS | RDS. `rds.force_ssl`, encrypted, PITR, deletion protection, Multi-AZ in production. Runtime uses `atlas_app` (NOBYPASSRLS); only the migrate task gets `atlas_owner` |
| Redis | ElastiCache Redis 7.1. `noeviction`, TLS in transit, AUTH token, encrypted at rest |
| Private object storage | S3. Public access blocked, SSE, versioning, TLS-only policy. Access through the task role only |
| Malware scanning | ClamAV service on Service Connect (`clamav:3310`), not reachable from outside the VPC |
| Secrets | Secrets Manager containers. Values are written by `scripts/deploy/aws-bootstrap.sh` or an operator, never by Terraform (nothing secret in state) |
| Logs and monitoring | CloudWatch log groups (365 days in production, 30 in staging). Alarms go to SNS email: 5xx, unhealthy targets, p95 latency, web/worker/clamav task count, RDS CPU/storage/memory, Redis memory, error-log rate, and a Route 53 HTTPS probe of `/api/ready` |
| Backups | RDS PITR plus AWS Backup daily snapshots of RDS and S3 (35 days in production, 7 in staging) |

**Cost:** every apply creates billable resources: NAT gateways, RDS, ElastiCache, Fargate tasks, the ALB, Route 53 health checks and backups. Estimate them with the AWS Pricing Calculator and get approval before the first apply. Staging uses smaller and single-AZ settings.

## One-time setup (per AWS account)

1. **State bucket.** Create a versioned, encrypted S3 bucket for Terraform state, e.g. `atlas-tfstate-<account-id>`.
2. **GitHub OIDC deploy role.** Create an IAM role trusted by `token.actions.githubusercontent.com`.
   - Restrict it to `repo:<owner>/<repo>:environment:staging` and `…:environment:production`.
   - Grant permissions for the resources in `infra/aws`.
3. **GitHub Environments.** Create `staging` and `production`. On `production`, add **required reviewers**. Each environment needs:
   - Secret `AWS_DEPLOY_ROLE_ARN`
   - Variables:
     - `AWS_REGION`
     - `TF_STATE_BUCKET`
     - `APP_URL` (e.g. `https://staging.app.example.com`)
4. **tfvars.** Fill in `infra/aws/env/<env>.tfvars`: `domain_name`, `route53_zone_id` (or leave it empty and create the DNS records by hand), `alarm_email` and `email_from`.

## First deployment of an environment

```bash
cd infra/aws
terraform init -backend-config="bucket=$TF_STATE_BUCKET" -backend-config="key=atlas/staging.tfstate" \
  -backend-config="region=eu-west-2" -backend-config="use_lockfile=true" -backend-config="encrypt=true"
# No images exist yet, so start with zero app tasks:
terraform apply -var-file=env/staging.tfvars -var image_tag=bootstrap -var web_desired_count=0 -var worker_desired_count=0
terraform output acm_validation_records   # only when route53_zone_id is empty: create these CNAMEs, plus the app record → alb_dns_name
cd ../.. && AWS_REGION=eu-west-2 scripts/deploy/aws-bootstrap.sh staging
```

`aws-bootstrap.sh` is idempotent and never overwrites an existing value. It does the following:

1. Generates the DB role passwords, `ENCRYPTION_KEY`, `EMAIL_WEBHOOK_SECRET` and the Redis AUTH token.
2. Writes `DATABASE_URL`, `MIGRATION_DATABASE_URL` and `REDIS_URL`.
3. Runs the `dbinit` task, which applies `scripts/db/bootstrap-roles.sql` inside the VPC.

**Back up `ENCRYPTION_KEY` to offline escrow straight away** (see [operations.md](operations.md#encryption-key-backup-rotation-and-recovery)). Rotate it only with that procedure.

Third-party secrets are written by an operator. Write each one from a 0600 file, never as a command-line value:

```bash
aws secretsmanager put-secret-value --secret-id atlas-staging/STRIPE_SECRET_KEY --secret-string file:///path/0600-file
```

- Use **Stripe test-mode** keys (`sk_test_…`) on staging, and on production until live keys are authorised.
- After writing the secrets, add their names to `enabled_optional_secrets`.
- Set `payment_provider = "stripe"` and `email_provider` as appropriate.
- Platform AI keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are optional. Organisation BYOK works without them. With `llm_provider = "none"`, no platform AI is served.

Then run **Actions → Deploy** with the commit SHA. It refuses any SHA that has no green CI run. Steps, in order:

1. Build and push immutable images.
2. Run the migrate task: `prisma migrate deploy`, the system seed, and `db:verify-ai-access`. A non-zero exit stops the rollout before the services are touched.
3. Roll out web, worker and ClamAV, then wait until they are stable.
4. Run the smoke tests:
   - `/api/health`, `/api/ready` and `/login` return 200.
   - HTTP redirects to HTTPS with a 301.
   - HSTS, CSP, nosniff and frame headers are present.
   - Anonymous API calls get 401.

Production runs only when `promote_to_production` is ticked, staging passed in the same run, and a required reviewer approves.

## After the first deploy (manual, with evidence)

1. **Default-deny AI check.** Before any grant exists, run the migrate task again with the command overridden to `npm run db:verify-ai-access -- --expect-no-grants`.
2. **First super admin** (procedure from [deployment.md](deployment.md) step 5):
   1. Set `platform_admin_emails` and apply.
   2. Register that account, verify the email and enrol MFA (mandatory).
   3. Clear `platform_admin_emails` and apply again.
3. **EICAR upload.** Upload the EICAR test file and confirm it is rejected (ClamAV is live).
4. **Tenant isolation.** Create two organisations and confirm that each organisation's ids return 404 for the other. E2E journey 19 can be run against staging.
5. **Provider matrix.** Work through [staging-provider-test-matrix.md](staging-provider-test-matrix.md) with test keys.
6. **Stripe.** Run the test-mode checkout, then the webhook to `https://<host>/api/v1/webhooks/stripe`, then the portal.
7. **Restore drill.** Restore RDS to a point in time into a scratch instance and record the RTO/RPO.

## Rollback

- **Normal case.** The ECS deployment circuit breaker reverts a failed rollout to the previous task definition. To roll back by hand, re-run Deploy with an earlier **green** SHA.
- **Releases before the AI access feature.** Never roll back to a release that predates the AI access checks before you set `llm_provider = "none"` and remove the platform AI key secrets from `enabled_optional_secrets` ([operations.md](operations.md#rollback)). Older code has no grant checks.
- **Migrations.** Migrations are additive. Do not roll the database back; roll the application forward.
