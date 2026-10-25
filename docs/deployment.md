# Deployment

## Topology

| Component | Image / command | Scaling | Notes |
|---|---|---|---|
| Web | `Dockerfile` target `web` (`node server.js`, port 3000) | Horizontal, stateless | Health `/api/health` (process), readiness `/api/ready` (DB + Redis) |
| Worker | target `tooling`, `npm run worker` | Horizontal | Health `:WORKER_HEALTH_PORT/` |
| Migrations | target `tooling`, `npx prisma migrate deploy` | One-shot per release | Runs as `atlas_owner` (`MIGRATION_DATABASE_URL`) |
| PostgreSQL 16 | Managed (RDS/Cloud SQL/Azure/Neon…) | Primary + standby | PITR on; TLS; private network |
| Redis 7 | Managed | Single primary + replica | `maxmemory-policy noeviction` (BullMQ requirement) |
| Object storage | S3-compatible | — | Private bucket, encryption, versioning |
| ClamAV | `clamav/clamav` | 1+ | Required before accepting public uploads |

Any container platform works (ECS/Fargate, Cloud Run + a worker service, Kubernetes, Fly, Render). Terminate TLS at the load balancer and set `TRUST_PROXY=true` only when it sets `X-Forwarded-For`.

## Environments

| | Staging | Production |
|---|---|---|
| `APP_ENV` | `staging` | `production` |
| Providers | Real provider *test* accounts (Stripe test mode, AI keys with low limits) | Live accounts |
| Data | Synthetic only — never copy production candidate data | — |
| `SEED_DEMO`, `EXPOSE_TEST_TOKENS`, `ALLOW_FIXTURE_PROVIDERS` | false | false (fixtures and test tokens are refused/ignored) |

## First-time setup

1. **Database:** create the instance, then run `scripts/db/bootstrap-roles.sql` as an admin with passwords from your secret manager. Store `DATABASE_URL` (atlas_app) and `MIGRATION_DATABASE_URL` (atlas_owner) as secrets; give only the migration job the owner URL. Add `?sslmode=require` (and `connection_limit`/pooler settings) as appropriate.
2. **Secrets:** generate `ENCRYPTION_KEY` (`openssl rand -base64 32`) — losing it makes stored MFA/integration secrets unreadable, so back it up in the secret manager. Add provider keys (see [providers.md](providers.md)).
3. **Build:** `docker build --target web -t <registry>/atlas-web:<git-sha> .` and `--target tooling -t <registry>/atlas-tooling:<git-sha>`. Pass `NEXT_PUBLIC_*` branding as build args. Use `--build-arg BASE_IMAGE=<mirror>/node:22-bookworm-slim` for a registry mirror.
4. **Migrate & seed:** run the tooling image with `sh -c "npx prisma migrate deploy && npm run db:seed"` (system data only; idempotent).
5. **First admin:** set `PLATFORM_ADMIN_EMAILS=you@company.com`, register that account, verify email, enrol MFA (mandatory), then clear the variable.
6. **AI access:** Admin → AI access — platform AI is denied by default. Grant it per organisation, capability and provider (with limits), and for personal accounts if student practice is offered. Organisations can alternatively connect their own keys in Settings → AI providers. Re-run `npm run db:seed` on each deploy so new permissions (e.g. `ai.manage`) reach system roles.
7. **Plans:** Admin → Plans: replace placeholder plans/packs, prices and Stripe Price ids ([billing.md](billing.md)).
8. **Domains & DNS:** `APP_URL=https://app.example.com` (exact public origin — used for CSRF checks and links). Configure email sending domain SPF/DKIM/DMARC. Stripe webhook → `https://app.example.com/api/v1/webhooks/stripe`.
9. **HTTPS:** TLS 1.2+ at the edge; HSTS is sent by the app in production. Cookies are `__Host-` + `Secure`, so the app must be served over HTTPS.
10. **Monitoring:** see [operations.md](operations.md).

## Release procedure

1. CI green on the commit (typecheck, lint, unit/integration, build, E2E, drift check, image build).
2. Deploy to staging: run migrations job, then roll web + worker. Smoke test (login, create job, send interview to a test candidate, complete it with real providers, review assessment, Stripe test checkout).
3. Production: take/confirm a fresh backup snapshot, run the migration job, roll worker then web (rolling, `maxUnavailable=0`).
4. Watch error rate, latency, queue depth and `/api/ready` for 30 minutes.

Migrations must be backward compatible with the previous release (expand → migrate → contract) so a rollback of the app does not need a schema rollback. See rollback in [operations.md](operations.md).

## Local full stack

`docker compose --env-file .env.docker up --build` — see README.
