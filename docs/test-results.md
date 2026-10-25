# Test results

## Update 2026-10-25 — tenant-aware AI provider access and BYOK

Re-run in full after adding platform AI grants, organisation-owned keys and Gemini (same environment; fixture providers only; **no live provider credentials were used**).

| Check | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | ✅ 0 errors |
| Lint | ✅ 0 errors, 1 pre-existing warning |
| Vitest (unit + integration) | ✅ 13 files, **142 / 142 passed** (was 108; +12 provider unit tests, +22 AI access integration tests; 5 existing journey tests updated to grant AI explicitly) |
| Playwright E2E | ✅ **9 / 9 passed** (+2: organisation connects its own key in Settings → AI providers with a bad key rejected first; super-admin grants platform AI in the admin console after TOTP login) |
| Migration drift | ✅ no difference |
| Production build | ✅ |
| Load test (`PERF_REQUESTS=100 PERF_INTERVIEWS=10`) | ✅ 0 errors; 10/10 concurrent interviews completed and assessed |

Required AI-access tests and where they live:

| Requirement | Test |
|---|---|
| Platform AI denied by default for a new organisation | `ai-access` "a new organisation cannot invoke, or indirectly reach…"; personal accounts too; E2E "AI access" |
| Platform admin granting and revoking | `ai-access` "grant enables exactly that capability; revocation stops the next operation; both are audited"; E2E 18b |
| Only super-admins (MFA) can change grants; org cannot self-grant | `ai-access` "only MFA-verified super-admins…", "an organisation cannot grant itself platform AI, even with direct database access" (RLS) |
| Organisation key works without platform permission | `ai-access` BYOK tests; conversational interview test in `privacy-platform` runs on an org key |
| No unauthorised fallback | `ai-access` "No unauthorised fallback" (removed selected key, quota on org key, key rejected at use time) |
| Tenant A never uses Tenant B's key | `ai-access` "tenant A's key is never used for, or visible to, tenant B"; forged org header |
| Gemini configuration, connection failures, quota errors | `ai-providers` unit tests on the official SDK with stubbed HTTP: structured output, header-only key, 429 (no retry, no model switch), 5xx retry, auth failure, model checks, safety/truncation/invalid output |
| Model restrictions and unsupported models | `ai-access` "Model restrictions"; `ai-providers` catalogue tests |
| Concurrent jobs and credential rotation | `ai-access` limit of 3 under 8 concurrent requests (exactly 3 succeed), token limit, rotation versioning |
| Background-worker tenant isolation and revocation | `ai-access` "revocation before a queued assessment starts stops it; the job never borrows another tenant's access" |
| Secret redaction and access control | `ai-providers` scrubbing + logger redaction + SDK env-key fallback guard; `ai-access` encryption at rest, masked API output, `ai.manage` enforcement at service and route |

Bug found and fixed by these tests: a queue retry of a failed assessment tried `FAILED → ASSESSED` (forbidden by the state machine); it now re-enters `PROCESSING` first.

---

## Initial build (2026-10-24)

Results of checks **actually executed** in the build environment (Linux container, 4 vCPU, 15 GB RAM, Node 22.22, PostgreSQL 16 local, Redis 7 local) on 2026-10-24. All AI/speech providers were **fixture** providers. No real provider, email, storage or payment accounts were used.

## Summary

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ 0 errors |
| Lint | `next lint` | ✅ 0 errors, 1 warning (`<img>` for a data-URL QR code) |
| Unit + integration | `npx vitest run` | ✅ 11 files, **108 / 108 passed** |
| Browser E2E | `npx playwright test` (Chromium, fake mic) | ✅ **7 / 7 passed** (covers 11 of the 20 journeys in the browser; all 20 covered across E2E + integration) |
| Production build | `npm run build` | ✅ succeeded |
| Migration drift | `prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` | ✅ no difference |
| DB role bootstrap | `scripts/db/bootstrap-roles.sql` on a fresh database, then `migrate deploy` | ✅ app role confirmed `rolbypassrls = false` |
| Docker images | `docker build --target web` / `--target tooling` (base `node:22-bookworm` via mirror) | ✅ built; web container healthy (`/api/health`, `/api/ready`, pages, login 200); worker container healthy against Redis; migrate + seed ran from the tooling image |
| Load / concurrency | `npm run perf` | ✅ 0 errors (table below) |
| `.env.example` | loaded and validated by `src/server/env.ts` | ✅ |
| `npm audit --omit=dev` | | ⚠️ 7 advisories (6 high, 1 moderate) that need major upgrades — see known-limitations |

Not run here: the GitHub Actions workflow itself (only its steps were run locally), `docker compose up` as a whole, any live provider, a WCAG audit, a penetration test.

## The 20 required journeys

| # | Journey | Where tested |
|---|---|---|
| 1 | Organisation registration & verification | E2E 1–2; integration `recruitment-flow` #1 |
| 2 | Owner invites multiple HR employees | E2E 1–2; `recruitment-flow` #2 (email-bound, single-use invites) |
| 3 | HR creates a vacancy | E2E 3–4; `recruitment-flow` #3 (AI drafts need human review) |
| 4 | HR configures an AI interview | E2E 3–4; `recruitment-flow` #4 |
| 5 | Candidate receives an invitation | E2E 5–8; `recruitment-flow` #5 (credit reserved) |
| 6 | Candidate completes each interview mode | Structured: E2E 5–8 (browser) + `recruitment-flow` #6 (typed, audio, retake). Conversational: `privacy-platform` "runs a full conversation…" (server pipeline only — no browser test) |
| 7 | Assessment generated and reviewed | E2E 5–8; `recruitment-flow` #7 (verified evidence, credit consumed, HR review) |
| 8 | HR makes a hiring-stage decision | E2E 5–8; `recruitment-flow` #8 (recruiter without rights is blocked) |
| 9 | Student registers & completes profile | E2E 9–10; `student-flow` #9 |
| 10 | Student discovers & applies to an eligible vacancy | E2E 9–10; `student-flow` #10 |
| 11 | Student completes an employer-assigned interview | E2E 5–8; `student-flow` #11 (one identity, one charge) |
| 12 | Private practice interview | E2E 12; `student-flow` #12 (student-billed, invisible to employers) |
| 13 | Student sees only authorised feedback | E2E 13; `student-flow` #13 |
| 14 | University admin manages an authorised cohort | `student-flow` #14 (consent-gated visibility) |
| 15 | Organisation purchases credits | `billing` #15 |
| 16 | Subscription renews or fails | `billing` #16 (renewal, failure → PAST_DUE, recovery) |
| 17 | Duplicate payment webhooks processed safely | `billing` #15 (repeated delivery), forged/unsigned rejection |
| 18 | Super admin manages an organisation | `privacy-platform` (suspend, reactivate, verify, adjust credits, with reasons + audit; support access approval; last-admin protection) |
| 19 | Tenant A attempts to access Tenant B | E2E 19; `security` (404 not 403, forged org header, applications, search/export/reports, files, jobs); `rls` (DB level) |
| 20 | Data export or deletion | `privacy-platform` (export without secrets; deletion purges files and forwards erasure to employers; retention sweep) |

## Security tests (required list)

| Attempt | Test |
|---|---|
| Cross-tenant access | `rls.test.ts` (9 tests), `security.test.ts`, E2E 19 |
| Privilege escalation | `security` "members cannot escalate privileges", "platform endpoints … require MFA"; `rbac.test.ts` |
| Forged organisation identifiers | `security` "forged organisation header…" |
| Unauthorised recording access | `security` file links per-request authorisation; `recruitment-flow` #7 (audio only with consent + permission) |
| Invalid invitation reuse | `recruitment-flow` #2; `security` "interview tokens grant access to exactly one session and stop working after completion" |
| Session fixation & abuse | `security` "login always issues a fresh session; logout and revocation invalidate it"; `privacy-platform` reset revokes sessions, lockout, MFA partial sessions |
| Malicious uploads | `security` "rejects disguised executables and oversized uploads" |
| Webhook forgery | `billing` "rejects forged or unsigned webhooks" |
| Credit race conditions | `billing` "concurrent reservations never overdraw", idempotent settlement, immutable ledger |
| Sensitive-data leakage via logs/errors | `security` log redaction, structured errors without stack traces, oversized JSON 413 |
| CSRF | `security` "state-changing requests require a same-origin Origin header" |

## Performance (local, fixture providers)

`npm run perf` against `next start` (production build, single Node process, inline queue, `RATE_LIMIT_MULTIPLIER=50`), 20 concurrent clients, 300 requests per endpoint; then 20 candidate interviews run **simultaneously** (state → consent → start → 1 audio answer + 2 typed answers → complete incl. assessment).

| Endpoint | n | errors | p50 ms | p95 ms | p99 ms | req/s |
|---|---|---|---|---|---|---|
| GET /api/health | 300 | 0 | 47 | 93 | 97 | 381 |
| GET /api/ready | 300 | 0 | 55 | 62 | 101 | 349 |
| GET /opportunities (public) | 300 | 0 | 88 | 121 | 127 | 217 |
| GET /auth/me | 300 | 0 | 67 | 83 | 110 | 285 |
| GET /jobs | 301 | 0 | 91 | 118 | 151 | 214 |
| GET /applications | 300 | 0 | 121 | 158 | 172 | 158 |
| GET /analytics/dashboard | 300 | 0 | 140 | 240 | 258 | 134 |
| interview GET state | 20 | 0 | 162 | 205 | 206 | |
| interview POST consent | 20 | 0 | 145 | 181 | 183 | |
| interview POST start | 20 | 0 | 221 | 264 | 265 | |
| interview POST answer (audio → STT) | 20 | 0 | 331 | 364 | 368 | |
| interview POST answer (typed) | 40 | 0 | 235 | 288 | 335 | |
| interview POST complete (+ assessment) | 20 | 0 | 694 | 727 | 730 | |
| **interview end-to-end** | 20 | 0 | 2009 | 2052 | 2058 | |

All 20 interviews ended `ASSESSED`, credits `CONSUMED`, labelled `FIXTURE` (checked in the database on an earlier identical run).

**Interpretation:** these numbers are platform overhead only (app + Postgres on one machine, with load generator on the same host). With real providers, audio answer latency is dominated by STT and conversational turns by STT + LLM + TTS (typically seconds); assessment moves to the worker in `QUEUE_MODE=redis` so `complete` returns faster. Re-run `npm run perf` on staging with real providers and production-like infrastructure before setting SLOs.
