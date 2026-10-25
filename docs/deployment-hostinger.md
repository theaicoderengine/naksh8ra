# Deploying on Hostinger (Node.js Web App hosting)

This is the production deployment path for Hostinger **Business or Cloud** web hosting (hPanel → Websites → Node.js Web App). It needs no VPS, no Docker and no Redis. The AWS material in `infra/aws` and `docs/deployment-aws.md` is a separate, optional path and is not used here.

> **Verification status.** The full deployment sequence was rehearsed end to end in CI and locally (`scripts/hostinger/rehearse.sh`): production-mode configuration from `.env.hostinger.example`, the Hostinger build (preflight → build → migrations → seed → AI-access verification), `npm start`, live checks, and a real background job delivered through the Postgres queue. The rehearsal used local stand-ins: PostgreSQL 16, an S3 API (moto) and an SMTP sink. **It has not run on Hostinger itself, on a managed PostgreSQL service, on Cloudflare R2 or with live email, Stripe or AI providers.** The go-live procedure below includes those checks.

## 1. How the application maps onto Hostinger

| Hostinger constraint (Hostinger docs, Oct 2026) | How ATLAS handles it |
|---|---|
| One long-running Node.js process per site; no separate background workers | Background jobs use a **durable PostgreSQL queue** (`QUEUE_MODE=postgres`) processed **inside the web process**. Jobs are claimed with `SKIP LOCKED` under renewable leases, retried with backoff up to 5 attempts, then left `FAILED`. Failed jobs are visible and retryable in Admin → Operations (`/admin/health`). Nothing is reported done unless its handler finished. |
| Idle sites may be stopped and started on the next request | An **hPanel cron job calls `/api/internal/jobs/tick` every minute**. The call wakes the site, schedules recurring jobs (session timeouts, reminders, retention, billing reconciliation, AI reservation sweep) and starts the runner. A job interrupted by a stop is reclaimed when its lease expires. `/api/health/jobs` turns red after 15 minutes without progress. |
| Requests are stopped after 120 s | Every API request has a **100 s budget** (`REQUEST_DEADLINE_MS`). AI and speech calls get a per-attempt timeout capped by the remaining budget, and a retry is skipped when it could not finish in time. The user then gets a clean error instead of a cut-off. Long work (assessments, résumé parsing, feedback, exports) runs as jobs. |
| Cron jobs run in UTC, stop after 30 min, and receive no site environment variables | The cron job is a single HTTPS call carrying `CRON_SECRET`, so the secrets stay in the site's environment. All schedules are UTC. |
| No Redis | Rate limits fall back to PostgreSQL (atomic upserts). An external Redis (`REDIS_URL`) is optional and only speeds up rate limiting. |
| No PostgreSQL on web/cloud plans | **External managed PostgreSQL 16+**. The pooled endpoint serves the app and the direct endpoint serves migrations. |
| No inbound WebSockets | Not used. Interviews are turn-based HTTP. |
| Redeploys rebuild the app folder; runtime files may not survive | All files (CVs, recordings, exports) go to **S3-compatible object storage**. Production refuses local disk storage. |
| Shared process limit (NPROC) per plan; spawned child processes can leak | The app spawns no child processes at runtime. Job concurrency inside the process is bounded (`JOB_CONCURRENCY=2`). |
| No ClamAV daemon | Malware scanning is unavailable. Uploads are still type-checked by content (magic bytes) and size-limited, and are stored and shown as **"not scanned"**. Production requires the explicit acknowledgement `ALLOW_UNSCANNED_UPLOADS=true`. See §9. |
| Supported Node.js 18/20/22/24 | **Node.js 22.x** (`.nvmrc`, `engines`). |

Unchanged on Hostinger: tenant isolation (PostgreSQL row-level security with a non-owner, non-BYPASSRLS runtime role), BYOK encryption (AES-256-GCM, `ENCRYPTION_KEY`), authentication and mandatory MFA for platform roles, rate limits, append-only audit log, default-deny platform AI grants and platform-admin permissions.

## 2. External services to set up

These are required because Hostinger web hosting cannot provide them. The recommendations are concrete defaults; equivalents work.

| Service | Recommended | Requirements |
|---|---|---|
| PostgreSQL 16 or 17 | **Neon** (or Supabase) in the region nearest your Hostinger data centre | A pooled endpoint (PgBouncer / transaction mode) and a direct endpoint; an admin user with CREATEROLE + CREATEDB (true for both); point-in-time restore on the plan |
| Object storage | **Cloudflare R2** (or Backblaze B2) | A private bucket and an API token scoped to that bucket with object read/write. Set `S3_SSE=none` for R2 (encrypts at rest itself) and `AES256` for B2 or AWS |
| Email | **Postmark** (or Resend, or SMTP incl. Hostinger mail for low volume) | A verified sending domain with SPF, DKIM and DMARC records |
| Payments | **Stripe — test mode** until live payments are authorised | A webhook endpoint `https://<domain>/api/v1/webhooks/stripe`. A live key is refused unless `STRIPE_LIVE_APPROVED=true` |
| Platform AI (optional) | Gemini / OpenAI / Anthropic keys | Not needed for organisation BYOK. Platform AI stays deny-by-default per organisation |
| Uptime monitoring | Any HTTP monitor (e.g. UptimeRobot, Better Stack) | Monitors `/api/ready` and `/api/health/jobs` |

## 3. Database (one time)

1. Create a project and a database named `atlas`, or let the bootstrap create it.
2. Generate passwords and keys on your own machine: `npm run secrets:generate`. Store the output in your password manager.
3. Create the two roles with `scripts/db/bootstrap-roles.sql`. It is idempotent and works as a provider admin that is not a superuser; that path is verified in CI. Choose one:
   - **GitHub (no local tools):** add the secrets `ADMIN_DATABASE_URL` (the provider's admin connection string, **direct** endpoint), `ATLAS_OWNER_PASSWORD` and `ATLAS_APP_PASSWORD` to a GitHub environment named `production`. Then run **Actions → Database bootstrap (managed PostgreSQL)**.
   - **psql:** `psql "$ADMIN_DATABASE_URL" -v owner_password="'…'" -v app_password="'…'" -v db_name=atlas -f scripts/db/bootstrap-roles.sql`
4. Build the two connection strings:
   - `DATABASE_URL` uses `atlas_app` on the **pooled** host and ends with `?schema=public&sslmode=require&pgbouncer=true&connection_limit=5`.
   - `MIGRATION_DATABASE_URL` uses `atlas_owner` on the **direct** host and ends with `?schema=public&sslmode=require`.

Migrations run automatically on every deploy, after a successful build. They are additive and safe to re-run (`prisma migrate deploy` applies only pending migrations under an advisory lock). If a migration fails, the deploy fails and Hostinger keeps the previous release.

## 4. Object storage (one time)

R2 example:
1. Create the bucket `atlas-files` and leave public access off.
2. Create an R2 API token with *Object Read & Write* on that bucket only.
3. Set `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=true` and `S3_SSE=none`, plus the token's key id and secret.

The build's preflight writes, reads and deletes a test object, so wrong credentials fail the deploy instead of the first upload.

## 5. hPanel settings

hPanel → Websites → **Add website → Node.js Web App** (Business or Cloud plan). Connect the GitHub repository; pushes then redeploy automatically.

| Setting | Value |
|---|---|
| Framework preset | **Next.js** |
| Node.js version | **22.x** |
| Repository / branch | `theaicoderengine/naksh8ra` / the release branch (currently `claude/atlas-hiring-build`) |
| Root directory | `/` (repository root) |
| Install | automatic (`npm install` / `npm ci`). Do **not** set `NODE_ENV`: the build needs dev tooling |
| Build command | `npm run build` |
| Start command | `npm start` |
| Output directory (if asked) | `.next` |
| Environment variables | import a filled-in copy of **`.env.hostinger.example`** (see §6) |
| Domain / HTTPS | attach the domain in hPanel and enable the free SSL certificate. `APP_URL` must be exactly `https://<that domain>` |

With `DEPLOY_TARGET=hostinger`, `npm run build` runs these steps in order and stops at the first failure:
1. Preflight. It validates the configuration, checks that the runtime role cannot bypass RLS and does not own the schema, checks that both database roles connect, and runs an object-storage round trip.
2. `prisma generate` and `next build`.
3. Migrations.
4. System seed.
5. AI-access invariant verification.

`npm start` starts Next.js. On start-up the server validates its configuration again and refuses to run if it is unsafe; with the Postgres queue it then starts the in-process job runner.

## 6. Environment variables

The template is **`.env.hostinger.example`**. Every variable is marked [SECRET], [GENERATE], [SET] or [DEFAULT], and the defaults are correct for Hostinger. You must supply:

| Variable | Kind | Source |
|---|---|---|
| `APP_URL`, `APP_NAME`, `APP_SUPPORT_EMAIL`, `APP_ENV` | set | your domain; `production` (or `staging` on a staging site) |
| `DATABASE_URL`, `MIGRATION_DATABASE_URL` | secret | §3 |
| `ENCRYPTION_KEY` | generate, secret | `npm run secrets:generate`. **Back it up offline. Never change it** except through the rotation in [operations.md](operations.md#encryption-key-backup-rotation-and-recovery) |
| `CRON_SECRET` | generate, secret | `npm run secrets:generate` (also used in the cron command) |
| `EMAIL_WEBHOOK_SECRET` | generate, secret | `npm run secrets:generate` |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_SSE` | set | §4 |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | secret | §4 |
| `EMAIL_PROVIDER`, `EMAIL_FROM` | set | email service |
| `POSTMARK_SERVER_TOKEN` / `RESEND_API_KEY` / `SMTP_URL` | secret | email service |
| `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET` | set / secret | Stripe test mode, when billing is enabled |
| `LLM_PROVIDER` + `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | set / secret | optional platform AI |
| `STT_PROVIDER` (+ `OPENAI_API_KEY` or `DEEPGRAM_API_KEY`), `TTS_PROVIDER` | set / secret | optional speech |
| `PLATFORM_ADMIN_EMAILS` | set | only while creating the first super admin (§8 step 6) |
| `ALLOW_UNSCANNED_UPLOADS=true` | set | explicit acknowledgement (§9) |

Changing a variable needs **Save and redeploy**. Never paste secrets into the repository, issues or chat.

## 7. Cron job, monitoring, logs, backups

**Cron (required).** hPanel → the site → Advanced → **Cron Jobs**. Add a job that runs **every minute**:

```
curl -fsS -m 60 -X POST -H "Authorization: Bearer <CRON_SECRET>" https://<domain>/api/internal/jobs/tick -o /dev/null
```

If the panel only accepts Node commands, use:

```
node -e "fetch('https://<domain>/api/internal/jobs/tick',{method:'POST',headers:{authorization:'Bearer <CRON_SECRET>'}}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
```

- If the panel's minimum interval is longer, use it. Recurring jobs run at their next slot; missed slots collapse into one run.
- An external scheduler (e.g. cron-job.org) calling the same URL is an equivalent fallback.

**Health checks.** Hostinger has no configurable health checks, so add an uptime monitor for each endpoint:

| Endpoint | Meaning | Alert when |
|---|---|---|
| `/api/health` | process alive | non-200 |
| `/api/ready` | database reachable, schema matches this release (`migrations: up_to_date`) | non-200 |
| `/api/health/jobs` | jobs progressing and runner seen within 15 min | non-200 (usually means the cron job is missing or the site is down) |

**Logs.** The app writes structured JSON (pino) to stdout. Read it in hPanel → the site → **Runtime logs**; build output is under **Deployments**. Logs redact passwords, tokens, cookies, API keys and candidate content fields. Error-level entries (`"level":50`) are the ones to watch. The platform dashboard (Admin → Operations (`/admin/health`)) shows database, queue health, stale jobs, failed jobs with retry, email delivery and provider configuration.

**Backups.**
1. Enable the database provider's **point-in-time restore**. This is the primary recovery mechanism.
2. **Nightly encrypted logical backup** (`.github/workflows/db-backup.yml`). The dump → encrypt → decrypt → restore cycle was tested locally; grants, RLS policies and triggers survived the restore. Setup:
   - GitHub environment `production-backup` with these secrets:
     - `BACKUP_DATABASE_URL` (atlas_owner, direct endpoint)
     - `BACKUP_PASSPHRASE` (store it with `ENCRYPTION_KEY`)
     - `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`
   - Repository variables:
     - `BACKUP_ENABLED=true`
     - `BACKUP_S3_BUCKET` (a **separate** bucket)
     - `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`
   - Until it is configured the job shows as *skipped*, never as a successful backup.
3. **Restore drill.** Do this once before launch and record RTO and RPO:
   1. Download the dump, then `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:PASSPHRASE -in X.dump.enc -out X.dump`.
   2. Create an empty database with the bootstrap script.
   3. `pg_restore --no-owner -d "<atlas_owner URL of the new database>" X.dump`.
   4. Point a staging site at it and run the verifier.
4. **Files.** Enable bucket-level protection at the storage provider (e.g. R2 object lock or bucket replication where available) or copy the bucket on a schedule. This is not automated here.
5. **`ENCRYPTION_KEY`.** Without it, restored MFA secrets and organisation AI keys are unreadable. Keep it in an offline escrow.

## 8. Go-live procedure

1. **Services:** create the database (§3), storage (§4), email domain, and the Stripe test account and webhook.
2. **Staging first.** Create a second Node.js Web App (e.g. `staging.<domain>`) with its own database and bucket, and `APP_ENV=staging`. Synthetic data only.
3. **Configure:** fill in `.env.hostinger.example`, import it in hPanel, and apply the §5 settings. Deploy. The build log must end with `✔ Hostinger build complete`; any ✖ line names the problem.
4. **Cron:** add the cron job (§7).
5. **Verify:**
   - Run `npm run hostinger:verify -- https://<domain> --cron-secret=<CRON_SECRET>` locally, or run Actions → **Verify Hostinger deployment**.
   - All checks must pass: liveness, readiness with migrations `up_to_date`, jobs, login page and security headers, HTTP→HTTPS redirect, anonymous API refused, and the cron tick both refused without the secret and working with it.
   - Add the uptime monitors.
6. **First super admin:**
   1. Set `PLATFORM_ADMIN_EMAILS=<you>` and redeploy.
   2. Register that account and verify the email (proves email delivery).
   3. Enrol MFA (mandatory for platform roles).
   4. Clear `PLATFORM_ADMIN_EMAILS` and redeploy.
7. **AI access check:**
   1. With no grants yet, run `npm run db:verify-ai-access -- --expect-no-grants` with `MIGRATION_DATABASE_URL` set, from any machine with Node.
   2. In the app, confirm that an organisation without grants or its own key gets "… is not available: this organisation has not connected its own AI provider …".
   3. Connect an organisation's own Gemini, OpenAI or Anthropic key in Settings → AI providers and confirm it works.
8. **Functional checks on staging:**
   1. Create an employer organisation.
   2. Create a vacancy and an interview template.
   3. Invite a test candidate, complete the interview, and see the assessment appear (a background job).
   4. Upload a CV and download it (storage).
   5. Create a second organisation and confirm it cannot see the first one's records (tenant isolation).
   6. Run a Stripe test checkout and webhook.
   7. Work through [staging-provider-test-matrix.md](staging-provider-test-matrix.md) with test keys.
9. **Backups:** enable PITR and the backup workflow, and run one restore drill.
10. **Production:** repeat steps 3–7 on the production site, with production database, bucket and keys. Keep Stripe in test mode until live payments are authorised. Then set the live key and `STRIPE_LIVE_APPROVED=true`, and redeploy.
11. Work through [launch-checklist.md](launch-checklist.md) for the non-technical launch items (legal review, DPAs, bias audit where required, penetration test).

## 9. Known limitations on Hostinger

- **No malware scanning.** ClamAV cannot run on web hosting. Uploads are restricted by content type and size and labelled "not scanned" to employers. To add scanning, run `clamd` on a host you control. Reach it only over a private network or TLS tunnel, and set `MALWARE_SCANNER=clamav` with `CLAMAV_HOST`/`CLAMAV_PORT`. Treat scanning as a launch blocker if you accept uploads from the public at scale.
- **Job latency.** Jobs start within seconds while the site is running, and within a minute of the next cron tick after an idle stop. An assessment interrupted by a stop restarts after its lease expires (up to 10 minutes).
- **Capacity.** One Node process per site (shared plan NPROC/memory). For high interview volume, move the same code to a container platform with `QUEUE_MODE=redis` and separate workers (`docs/deployment.md`). No code changes are needed.
- **Request time.** An AI call that would exceed the 100 s budget fails with a retryable message rather than finishing.
- **Next.js build memory.** The build runs on the hosting account. If it fails with out-of-memory, retry the deploy (it is idempotent) or use a higher plan.

## 10. Rollback

- **Application:** redeploy the previous commit from hPanel → Deployments, or push a revert to the release branch. Migrations are additive, so the previous release runs on the newer schema.
- **Never roll back to a release that predates the platform AI access checks** without first setting `LLM_PROVIDER=none` and removing the platform AI keys ([operations.md](operations.md#rollback)). Older code has no grant checks.
- **Do not roll back migrations.** Fix forward. For data loss, restore from PITR into a new database and point `DATABASE_URL`/`MIGRATION_DATABASE_URL` at it.

## Sources (Hostinger documentation consulted Oct 2026)

- [Node.js overview](https://docs.hostinger.com/node.js/overview)
- [Node.js limits for web and cloud plans](https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/)
- [How to add a Node.js web app](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Databases and data tools supported](https://www.hostinger.com/support/which-databases-and-data-tools-are-supported-at-hostinger/)
- [Fix "failed to build the application"](https://www.hostinger.com/support/fix-failed-to-build-application-error-hostinger-node-js/)
- [Redeploy a Node.js application](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/)

Re-check the limits page for your plan; some Hostinger pages conflict (e.g. on idle shutdown), and this design works either way.
