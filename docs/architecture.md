# Architecture

## Overview

```
Browser ──HTTPS──▶ Next.js (web tier, stateless, N replicas)
                    ├─ App Router pages (React Server Components + client islands)
                    ├─ /api/v1/* REST handlers ── route() wrapper (auth, CSRF, RBAC, rate limit, validation, errors)
                    │        └─ services/*  (business rules, transactions, audit)
                    │              ├─ db/tenant.ts  withOrg / withUser / withSystem / withPurge  ─▶ PostgreSQL (RLS)
                    │              ├─ providers/*   LLM · STT · TTS · storage · email · scan · payments
                    │              └─ queue/*       enqueue ─▶ Redis (BullMQ)
                    └─ /api/health, /api/ready
Worker (npm run worker, M replicas) ◀── Redis: assessment, resume parsing, email, reminders,
                                         expiry/timeouts, retention sweep, DSR export/delete, reconciliation
```

- **Web tier** is stateless: sessions live in Postgres, files in object storage, jobs in Redis. Scale horizontally behind a load balancer.
- **Worker** scales independently (`WORKER_CONCURRENCY` per replica). Recurring schedules are registered idempotently via BullMQ job schedulers, so several replicas do not duplicate cron work.
- **Inline queue mode** (`QUEUE_MODE=inline`) executes jobs in-process for development and tests. Do not use it in production.

## Code layout

| Path | Contents |
|---|---|
| `src/app/(marketing)` | Public site: home, features, solutions, pricing (from DB plans), security, docs, legal templates, public job board |
| `src/app/(auth)`, `src/app/onboarding` | Login/MFA, registration (organisation / student), verification, password reset, invitation acceptance, onboarding wizards |
| `src/app/w/[slug]` | Organisation workspace (employers and universities) |
| `src/app/student` | Student portal |
| `src/app/interview` | Candidate interview room (token link or signed-in invitation) |
| `src/app/admin` | Platform administration console |
| `src/app/account` | Profile, security (MFA), privacy, support |
| `src/app/api/v1` | Versioned REST API (146 route files); OpenAPI generated from `src/server/openapi.ts` |
| `src/server/services` | Domain services — the only layer that writes data |
| `src/server/db` | Prisma client and tenant-context transaction helpers |
| `src/server/auth`, `rbac`, `http` | Sessions, crypto, TOTP, permission catalogue, request wrapper |
| `src/server/domain` | Pure state machines (jobs, applications, interview sessions, billing outcomes) |
| `src/server/ai` | Versioned prompts and output schemas |
| `src/server/providers` | Vendor adapters behind small interfaces |
| `src/server/queue`, `src/worker` | Job definitions, handlers, worker entry |
| `src/components`, `src/lib` | UI components (accessible primitives in `components/ui`), client helpers, shared Zod schemas |
| `prisma/` | Schema (84 models), migrations, seed |
| `tests/` | `unit`, `integration` (real Postgres), `e2e` (Playwright) |

The "repository layer" is Prisma accessed only through the tenant helpers inside services; route handlers never query the database for tenant data directly.

## Multi-tenancy

Defence in depth, three layers:

1. **Request context.** `route()` resolves the session, then the organisation from the `x-atlas-org` slug *by membership lookup* (`resolveOrgContext`). Client-supplied ids never select the tenant.
2. **Service checks.** Every service takes an `OrgContext`, asserts a permission (`ctx.assert("jobs.publish")`), and filters by `organisationId`. Recruiters are additionally limited to assigned vacancies.
3. **PostgreSQL row-level security.** The runtime role `atlas_app` is not the table owner and has `NOBYPASSRLS`. Each transaction sets `app.org_id` / `app.user_id` with `set_config(…, true)` (transaction-local, so pooled connections never carry context across requests). Policies restrict every tenant table; personal tables (student profile, practice) are restricted by `app.user_id`. Cross-tenant links use composite foreign keys `(id, organisationId)` so a row cannot reference another tenant's row even by mistake.

`withSystem(reason, …)` sets `app.bypass_rls` and is used only for token resolution (invitation → organisation), platform-admin operations (audited) and background maintenance. `withPurge` additionally allows deletes from append-only tables, for retention/erasure jobs only.

Caveat: the runtime role can technically call `set_config` itself, so RLS protects against application bugs (a missing filter), not against arbitrary SQL execution by an attacker who has compromised the app process. See [security.md](security.md).

## Data model (summary)

- **Identity:** `User`, `UserProfile`, `Session`, `AuthToken` (hashed, single-use), `ConsentRecord` (append-only).
- **Tenancy & access:** `Organisation` (type EMPLOYER | UNIVERSITY), `OrganisationMembership`, `Invitation`, `Role`/`Permission`/`RolePermission`, `SupportAccessGrant`, `AuditEvent` (append-only).
- **Recruitment:** `Department`, `Job`, `JobAssignment`, `JobCompetency`, `Candidate` (per-organisation record, optionally linked to a `User`), `Application`, `ApplicationStage`, `ApplicationStageHistory` (append-only), `CandidateNote`, `ReviewerFeedback`, `CandidateFeedbackDisclosure`.
- **Documents:** `StoredFile` (private object key, scan status, checksum), `CandidateDocument`, `ResumeVersion` (parsed fields + parser version).
- **Interviews:** `InterviewTemplate` (versioned) → `InterviewQuestion`, `TemplateCompetency`; `Competency` → `CompetencyRubric` (versioned); `InterviewInvitation` → `InterviewSession` (immutable config snapshot) → `SessionEvent` (append-only), `Answer`, `TranscriptSegment`, `AudioAsset`.
- **Assessment:** `Assessment` → `AssessmentResult` (per competency, rubric version) → `AssessmentEvidence` (quote, position, verified flag); `AssessmentReview` (human override with reason).
- **Students & universities:** `StudentProfile`, education/skills/projects/certifications/experience/preferences, `SavedJob`, `PracticeInterview`/`PracticeAnswer`/`PracticeFeedback`, `AccommodationRequest`, `UniversityProfile`, `PlacementProgramme`, `ProgrammeEmployer`, `StudentCohort`, `CohortMembership` (consent-gated).
- **Billing:** `Plan`, `PlanEntitlement`, `CreditPack`, `Subscription`, `CreditAccount`, `CreditLedgerEntry` (append-only, idempotency key unique per account), `UsageRecord`, `CheckoutSession`, `PaymentEvent` (unique provider event id), `Invoice`, `Refund`.
- **Operations:** `Notification`, `NotificationPreference`, `EmailDelivery`, `IntegrationConnection`, `WebhookEvent`, `SupportTicket`, `DataSubjectRequest`, `RetentionPolicy`, `DeletionJob`, `FeatureFlag`, `PlatformSetting`, `JobRun`, `RateLimitBucket`.

Migrations: `prisma/migrations/` — `init` (tables), `security_rls` (grants, policies, append-only triggers, CHECK constraints, search index), `signup_intent_jobrun_payload`. CI verifies migrations match the Prisma schema (`prisma migrate diff --exit-code`).

## Interview session state machine

Enforced server-side in `src/server/domain/state-machines.ts`; every transition writes a `SessionEvent`.

```
CREATED → INVITED → READY → IN_PROGRESS → PROCESSING → ASSESSED → REVIEWED → CLOSED
                                │   ▲            │          │
                                ▼   │            ▼          ▼
                           INTERRUPTED      REQUIRES_REVIEW ┘
Side exits: INVITED/READY → EXPIRED · any active → CANCELLED · IN_PROGRESS/INTERRUPTED/PROCESSING → FAILED (→ PROCESSING retry)
```

Candidates see a simplified status (e.g. "COMPLETED") and never see assessments, rubrics, guidance or internal notes.

**Conversational mode** is turn-based: the browser records an utterance (silence detection), the server transcribes it (STT), the LLM produces the next interviewer line under a server-held plan (question budget, follow-up limit, time limit), TTS or browser speech plays it. The server — not the model — decides when the interview ends. It is not a full-duplex streaming voice session; see known limitations.

## AI usage

All AI calls go through the tenant-aware resolver (`src/server/ai/access.ts`): organisation-selected route → organisation key → platform key with an explicit super-admin grant → clear error. See [ai-providers.md](ai-providers.md).


Prompts are versioned constants (`jd.v1`, `qgen.v1`, `turn.v1`, `assess.v1`, `resume.v1`, `practiceq.v1`, `practicefb.v1`) and every stored output records the prompt version and provider/model. All untrusted content (resumes, answers, job text) is wrapped in delimited input blocks with an explicit instruction that it is data, not instructions. Outputs are requested as JSON matching a schema and validated with Zod before use. Provider usage (tokens/seconds) is recorded in `UsageRecord` for cost monitoring.

## Background jobs

| Job | Trigger |
|---|---|
| `interview.assess` | Session completed |
| `practice.feedback` | Practice session completed |
| `resume.parse` | Resume uploaded |
| `email.send` | Any notification |
| `interview.reminders` | Hourly |
| `sessions.timeout` (also expires invitations; same handler as `invitations.expire`) | Every 5 minutes |
| `billing.reconcile` (also expires credit grants; same handler as `credits.expire`) | Hourly |
| `retention.sweep` | Daily 03:30 UTC |
| `dsr.export` / `dsr.delete` | Privacy request |

Each run is recorded in `JobRun` (status, attempts, payload for retry) and visible in Platform admin → Health.
