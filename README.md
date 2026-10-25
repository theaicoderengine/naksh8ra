# Atlas Hiring

Multi-tenant recruitment platform with AI-assisted interviews, a student career portal and university placement tools. "Atlas Hiring" is a working name; branding is configurable (`APP_NAME`, `NEXT_PUBLIC_*`).

> **Status: release candidate for staging, not yet production-verified.** All features below run end-to-end locally with deterministic *fixture* AI/speech providers. Live AI, speech, email, storage and payment providers are implemented as adapters but have **not** been exercised against real vendor accounts. See [docs/known-limitations.md](docs/known-limitations.md) and [docs/launch-checklist.md](docs/launch-checklist.md).

## What's in the box

| Area | Highlights |
|---|---|
| Employers | Organisation sign-up & onboarding wizard, team invitations with role assignment, departments, vacancies (AI draft requires human review before publishing), configurable pipeline stages, candidate search/compare/notes/feedback, bulk moves, CSV export, analytics, audit log |
| AI interviews | Two modes — **structured audio** (fixed/adaptive questions, timed answers, retakes, typed fallback) and **conversational** (turn-based interviewer with server-enforced plan and follow-ups). Server-side state machine, consent capture, accommodations, captions, resume after disconnect, expiry |
| Assessment | Competency rubrics (versioned), evidence quotes verified verbatim against the transcript, explicit `INSUFFICIENT_EVIDENCE`, coverage metric, `REQUIRES_REVIEW` flags, human review & override with reasons. No single opaque score; no inference of protected characteristics |
| Students | Profile (education, skills, projects, experience, preferences), resume upload & parsing (PDF/DOCX), explainable job discovery, saved jobs, applications with profile preview & consent, private practice interviews with coaching feedback, only employer-approved feedback visible |
| Universities | Placement programmes, cohorts with consent-gated student visibility, employer partnerships, placement reporting |
| AI providers | Platform AI denied by default and granted by super-admins per organisation, provider and capability (with limits); organisations can bring their own Gemini, OpenAI or Anthropic keys (encrypted, tested before activation, masked); one tenant-aware resolver with no silent fallback ([docs](docs/ai-providers.md)) |
| Billing | Plans & entitlements, Stripe hosted checkout/billing portal, signature-verified idempotent webhooks, immutable credit ledger (reserve → consume/release), student practice credits, reconciliation |
| Platform admin | Organisation management (suspend/verify/credit adjustments with reasons), plans, feature flags, health, support tickets, approval-based time-limited support access, privacy requests, audit, admin management. MFA mandatory |
| Privacy | Consent records, data export, account deletion with erasure forwarding, retention policies with sweep job |

## Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind · React Hook Form + Zod · PostgreSQL 16 + Prisma (row-level security) · background jobs on Redis + BullMQ workers or a durable PostgreSQL queue · S3-compatible storage · pluggable AI/STT/TTS/email/payment adapters · Vitest · Playwright.

Architecture: [docs/architecture.md](docs/architecture.md). API: `GET /api/v1/openapi.json` (also [docs/openapi.json](docs/openapi.json), rendered at `/docs/api`).

## Quick start (local)

Prerequisites: Node 22, PostgreSQL 16, (optional) Redis 7.

```bash
npm ci

# 1. Database roles: owner (migrations) + app (runtime, RLS enforced).
psql -U postgres -v owner_password="'atlas_owner_dev'" -v app_password="'atlas_app_dev'" \
     -v db_name=atlas -f scripts/db/bootstrap-roles.sql
psql -U postgres -v owner_password="'atlas_owner_dev'" -v app_password="'atlas_app_dev'" \
     -v db_name=atlas_test -f scripts/db/bootstrap-roles.sql      # for the test suite

# 2. Configuration
cp .env.example .env
#    For a self-contained dev setup set: QUEUE_MODE=inline LLM_PROVIDER=fixture
#    STT_PROVIDER=fixture ALLOW_FIXTURE_PROVIDERS=true EMAIL_PROVIDER=console
#    and the two database URLs with the passwords above.

# 3. Schema + seed
npm run db:migrate
SEED_DEMO=true npm run db:seed        # fictional demo data; prints demo logins

# 4. Run
npm run dev                            # http://localhost:3000
npm run worker                         # only when QUEUE_MODE=redis
```

Demo logins (password `Demo-password-2026!` unless `SEED_DEMO_PASSWORD` is set): `owner@northwind.example`, `hr@northwind.example`, `recruiter@northwind.example`, `placement@uni.example`, `student@uni.example`, `admin@atlas.example` (TOTP secret printed by the seed). With `EMAIL_PROVIDER=console`, emails appear at `/dev/mailbox` (development only).

### Docker

```bash
cp .env.example .env.docker            # edit; set ENCRYPTION_KEY for staging-like runs
docker compose --env-file .env.docker up --build
```

Starts Postgres (roles bootstrapped automatically), Redis, Mailpit (`:8025`), a one-shot `migrate` job, `web` (`:3000`) and `worker`. Add `--profile scan` for ClamAV. Image targets: `web` (Next.js standalone) and `tooling` (worker, migrations, seed). Behind a registry mirror use `--build-arg BASE_IMAGE=...`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve build |
| `npm run worker` | Background worker (BullMQ) with schedulers and health endpoint (`WORKER_HEALTH_PORT`) |
| `npm run jobs:run` | Process the Postgres job queue once (SSH/cron; `QUEUE_MODE=postgres`) |
| `npm run hostinger:verify -- <url>` | Post-deployment checks against a live URL |
| `npm run secrets:generate` | Fresh ENCRYPTION_KEY / CRON_SECRET / webhook secret / DB passwords (new deployments only) |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`, uses `MIGRATION_DATABASE_URL`) |
| `npm run db:seed` | System roles/permissions/defaults; `SEED_DEMO=true` adds demo data (refused in production) |
| `npm run typecheck` / `lint` | TypeScript / ESLint |
| `npm test` | Unit + integration tests (Vitest, uses the `atlas_test` database) |
| `npm run test:e2e` | Playwright browser journeys (needs a built app with fixture providers + demo seed) |
| `npm run perf` | Load & concurrent-interview measurement against a running server |
| `npm run openapi` | Regenerate `docs/openapi.json` |

## Documentation

- [Architecture](docs/architecture.md) — layers, tenancy, data model, queues, providers
- [Security](docs/security.md) — authN/Z, RBAC, RLS, CSRF, uploads, logging
- [Privacy & retention](docs/privacy.md)
- [Responsible AI & assessment](docs/responsible-ai.md)
- [Billing & credits](docs/billing.md)
- [AI provider access & BYOK](docs/ai-providers.md) — platform grants, organisation keys, Gemini, resolution rules
- [Providers](docs/providers.md) — configuring AI, speech, email, storage, payments; current verification status
- **[Hostinger deployment](docs/deployment-hostinger.md)** — production path: Node.js Web App, managed PostgreSQL, S3-compatible storage, Postgres job queue + cron tick, env template `.env.hostinger.example`
- [Deployment](docs/deployment.md) — container platforms (web + worker + Redis), domains, TLS, secrets
- [AWS deployment](docs/deployment-aws.md) (optional, not used for Hostinger) — Terraform (ECS, RDS, ElastiCache, S3, ClamAV), bootstrap, gated deploy workflow
- [Operations runbook](docs/operations.md) — monitoring, backups, recovery, incidents, rollback, release checklist
- [Launch checklist](docs/launch-checklist.md)
- [Test results](docs/test-results.md) — what was actually run, and results
- [Known limitations](docs/known-limitations.md)

Legal pages (`/legal/*`) are templates and must be reviewed by counsel. Nothing in this repository is a claim of legal compliance or certification.
