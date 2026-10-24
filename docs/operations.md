# Operations runbook

## Monitoring

| Signal | Source | Alert when |
|---|---|---|
| Availability | `/api/health` (web), worker health port | 2 consecutive failures |
| Readiness | `/api/ready` (DB + Redis reachable) | failing > 2 min |
| Errors | JSON logs, `level>=50` (`"request failed"`) (ship to your log platform; `SENTRY_DSN` is reserved but no error-tracking SDK is wired in yet) | 5xx rate > 1% over 5 min |
| Latency | log field `ms` per request | p95 > 1 s (non-AI routes) |
| Queue | `JobRun` table / Admin → Health (failed jobs, queue depth) | failed jobs > 0 in 15 min; oldest waiting > 10 min |
| Interviews | `InterviewSession` status counts (FAILED, REQUIRES_REVIEW) | FAILED rate spike |
| AI providers | `PROVIDER_ERROR` codes in logs; `UsageRecord` cost | error spike; daily cost over budget |
| Billing | `billing.reconcile` mismatches (Admin → Health); `PaymentEvent` processing errors | any mismatch / unprocessed event |
| Email | `EmailDelivery` failures, bounce webhook | bounce rate > 5% |
| Database | provider metrics: CPU, connections, replication lag, storage | connections > 80%, lag > 30 s |

Every request has an `x-request-id` (response header and log field) — ask users for it when reporting problems.

## Backups and recovery

- **PostgreSQL:** managed automated backups with point-in-time recovery (≥ 14 days) plus a daily logical dump (`pg_dump -Fc` as atlas_owner) to a separate account/region. Encrypt backups.
- **Object storage:** bucket versioning + cross-region replication (or periodic sync). Retention deletions are intentional; versioned objects should expire per your policy so deleted data does not persist indefinitely.
- **Secrets:** `ENCRYPTION_KEY` and provider keys in the secret manager with version history.
- **Redis:** holds only queue state; jobs are also recorded in `JobRun` with payloads, so lost jobs can be re-enqueued from Admin → Health.

**Restore drill (quarterly):** restore the latest snapshot to a new instance → point a staging web/worker at it → run `npx prisma migrate status` → log in, open an interview review, play a recording → record RTO/RPO achieved.

**Point-in-time restore (incident):** stop workers → restore to the target time as a new instance → verify → switch `DATABASE_URL`/`MIGRATION_DATABASE_URL` → start web, then workers → reconcile Stripe events since the restore point (re-deliver from the Stripe dashboard; duplicates are ignored) → run `billing.reconcile`.

## Incident response

1. **Triage:** severity (S1 data exposure/outage, S2 major feature down, S3 degraded). Open an incident channel; one incident lead.
2. **Contain:** scale down / disable the affected feature (Admin → Flags), suspend an abusive organisation (Admin → Organisations, reason required), rotate credentials if leaked (DB role passwords, provider keys, `STRIPE_WEBHOOK_SECRET`; sessions can be revoked by rotating — all sessions for a user are revoked on password reset).
3. **Investigate:** logs by request id; `AuditEvent` for who-did-what; `SessionEvent` for interview timelines.
4. **Data breach:** involve legal immediately; regulatory notification deadlines may apply (e.g. 72 h under GDPR). Preserve evidence (snapshots, logs).
5. **Post-incident:** blameless review within 5 working days; action items tracked.

### Common issues

| Symptom | Likely cause / action |
|---|---|
| `/api/ready` failing | DB or Redis unreachable — check network/credentials; web keeps serving cached pages but API calls fail |
| Interviews stuck in PROCESSING | Worker down or AI provider errors — check worker health and logs; failed assessments move to FAILED and can be retried from the interview review page |
| "AI is not configured" | `LLM_PROVIDER`/key missing in that environment |
| Credits look wrong | Run reconciliation (Admin → Health); inspect ledger in organisation Billing; adjustments require a reason |
| Duplicate Stripe charge reports | Check `PaymentEvent` — each event id is processed once; refunds via Stripe dashboard flow back through `charge.refunded` |
| Emails not arriving | `EmailDelivery` status; provider dashboard; SPF/DKIM |
| Users locked out | Lockout lasts 15 minutes; password reset clears sessions |

## Rollback

- **App:** redeploy the previous image tag for web and worker (migrations are backward compatible by policy).
- **Migration gone wrong:** do not hand-edit `_prisma_migrations`. Write a forward fix migration; if data was damaged, PITR restore as above. Never run `prisma migrate reset` or `db push` against shared environments.
- **Bad configuration:** revert the secret/env version and restart.

## Release checklist

- [ ] CI green (incl. E2E and migration drift check)
- [ ] Migration reviewed for locking (large tables: add columns nullable, backfill in batches, build indexes `CONCURRENTLY` in a separate migration)
- [ ] Backward compatible with the previous app version
- [ ] Staging deploy + smoke test with real providers
- [ ] Backup confirmed < 24 h old
- [ ] Release notes; support informed of user-visible changes
- [ ] Deploy, watch dashboards 30 min, close release

## Routine maintenance

- Weekly: review failed jobs, REQUIRES_REVIEW backlog, open privacy requests (due dates), support tickets.
- Monthly: dependency updates (`npm audit`), provider cost review, access review of platform admins and support grants.
- Quarterly: restore drill, retention policy review, prompt/rubric quality review with HR.
