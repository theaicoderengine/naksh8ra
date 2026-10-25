# Security

This document describes the controls that are implemented and tested. It is not a certification or a substitute for an independent penetration test (recommended before launch).

## Authentication

- **Passwords:** scrypt (N=2^15, r=8, p=1), NFKC-normalised; at least 12 characters with letters plus a number or symbol (no breached-password lookup yet). Stored only as hashes.
- **Sessions:** random 256-bit tokens; only the SHA-256 hash is stored (`Session`). Cookie `__Host-atlas_session` in production (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`). A fresh session is issued on every login (no fixation); logout, password reset and admin revocation invalidate sessions. Default TTL 7 days, 12 hours for privileged sessions.
- **MFA:** TOTP (RFC 6238) with encrypted secrets (AES-256-GCM, `ENCRYPTION_KEY`). Mandatory for all platform roles; organisations can require it for members. Sessions remain partial until the code is verified.
- **Brute force:** per-IP and per-account rate limits (Redis, or Postgres fallback) and account lockout (8 failures → 15 minutes). Responses do not reveal whether an email exists (login, registration, password reset).
- **Tokens:** email verification, password reset, invitation and interview links are random, hashed at rest, single-use and time-limited. Organisation invitations are bound to the invited email address.
- **SSO:** not implemented (architecture allows adding an IdP adapter; see known limitations).

## Authorisation

- **Organisation roles:** OWNER, HR_ADMIN, RECRUITER, HIRING_MANAGER, INTERVIEWER, PLACEMENT_ADMIN, PLACEMENT_OFFICER — mapped to a permission catalogue in `src/server/rbac/permissions.ts` and stored in `Role`/`RolePermission`.
- **Separation of sensitive data:** transcripts (`interviews.view_transcripts`), recordings (`interviews.view_recordings`), assessment overrides (`assessments.review`), hiring decisions (`applications.decide`) and feedback disclosure (`feedback.disclose`) are distinct permissions. Recruiters only see vacancies they are assigned to.
- **No privilege escalation:** members can assign only roles at or below their own (`assignableRoles`); the last owner cannot be removed; the last super admin cannot be demoted; users cannot change their own role.
- **Platform roles:** SUPPORT (organisation metadata and tickets only), BILLING_ADMIN, SUPER_ADMIN. Support staff have **no** access to candidate recordings, resumes or transcripts. There is no "view as user"/impersonation feature. Platform staff may *request* support access to a workspace; an organisation owner approves or denies it; approvals expire after 24 hours and every step is audited. (Currently an approved grant is recorded but does not unlock any additional data view — if a support data view is added later it must check an active grant.)
- **Candidates/students** own their personal data. Universities see students only through consented cohort membership, never employer assessments.
- Every state-changing organisation endpoint declares a required permission; a contract test fails if one does not (`tests/unit/api-contract.test.ts`).

## AI credentials

- Platform AI keys stay in the server environment; organisations reach them only through explicit super-admin grants per provider and capability (deny by default; RLS prevents organisations writing grants).
- Organisation keys are AES-256-GCM encrypted, isolated by RLS, decrypted per operation on the server, and only masked metadata (last 4, short fingerprint) is ever returned. Keys are tested before activation.
- SDK clients are created per operation; empty keys are refused so SDKs cannot fall back to the platform's `*_API_KEY` environment variables.
- Provider error text is scrubbed of key-like strings before logging/storing; logs also redact `apiKey`, `encryptedKey` and provider key headers.
- No silent fallback across tenants, providers, models, or from an organisation key to a platform key; no provider-side model fallback. Details: [ai-providers.md](ai-providers.md).
- SDK clients ignore provider SDK environment variables (official endpoints pinned; un-overridable variables refuse start-up) so platform configuration never rides along on organisation-key requests.
- Candidates see neutral AI error messages (no provider, quota tier or configuration details); employers see details in their AI request log.
- Key rotation without data loss: `ENCRYPTION_KEY_PREVIOUS` + `npm run secrets:reencrypt` ([operations.md](operations.md#encryption-key-backup-rotation-and-recovery)).

## Tenant isolation

See [architecture.md](architecture.md#multi-tenancy). Tested by `tests/integration/rls.test.ts` (database level) and `tests/integration/security.test.ts` + E2E journey 19 (API/UI level): another tenant's ids return 404 (no existence oracle), forged organisation headers are rejected, search/export/reports/file links/background jobs are tenant-scoped.

Limitation: RLS context is set by the application. An attacker able to run arbitrary SQL as `atlas_app` could set `app.bypass_rls`. RLS is therefore a safety net against application bugs; protect the database credentials and network accordingly. Hardening option: move bypass to a separate `SECURITY DEFINER` function or a distinct role.

## Request handling

- **CSRF:** state-changing requests must carry an `Origin` (or `Referer`) matching `APP_URL`/host; cookies are `SameSite=Lax`.
- **Validation:** all bodies/queries validated with Zod; JSON bodies capped at 1 MB (413); multipart uploads capped by `MAX_UPLOAD_MB` (audio 25 MB).
- **Errors:** structured `{ error: { code, message, requestId } }`; 5xx responses are generic — no stack traces or SQL.
- **Rate limits:** login, registration, password reset, verification resend, mutations, uploads, interview turns, AI calls, contact form, invitation opening.
- **Headers:** CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS (production), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (microphone self only), COOP.
- **Webhooks:** Stripe signatures verified with `STRIPE_WEBHOOK_SECRET`; events stored by unique provider id so duplicates are no-ops. Email webhooks require `EMAIL_WEBHOOK_SECRET`.

## Files

- Private storage only; downloads go through `/api/v1/files/{id}`, which authorises every request and issues short-lived presigned URLs (S3) or streams (local).
- Type detection by magic bytes (not extension or client MIME); executables and disguised files rejected; size limits enforced.
- Malware scanning via ClamAV (`MALWARE_SCANNER=clamav`). When not configured, files are stored with status `NOT_SCANNED` and the UI says so. **Configure scanning before accepting public uploads.**

## Secrets & data protection

- No secrets in the repository; `.env*` is git-ignored except `.env.example` (placeholders).
- Provider API keys are server-side only; the browser never receives them. TTS audio is synthesised server-side or by the browser's own speech engine.
- Integration secrets and MFA secrets are encrypted at rest with `ENCRYPTION_KEY` (required outside development).
- Card data never touches the platform: payments use Stripe-hosted Checkout and Billing Portal.

## Logging & audit

- Structured JSON logs (pino) with request ids. Redaction of passwords, hashes, tokens, cookies, authorization headers, API keys and candidate content fields (`REDACT_PATHS` in `src/server/logger.ts`, covered by a test).
- `AuditEvent` is append-only (DB trigger) and records actor, action, target, reason and IP for security-relevant actions (role changes, decisions, overrides, exports, privacy actions, platform actions, support access).

## Dependency status

As of 2026-10-25, `npm audit` (all dependencies, including dev/build tooling) reports **0 vulnerabilities**: zod 4.6.6 (request-validation memory exhaustion), openai 6.49.0, vitest 5.0.3 (critical tooling advisories), plus `overrides` pinning patched transitive versions — `postcss` inside Next, `deepmerge-ts` 8 inside Prisma's config loader, `postcss-selector-parser` 7 under Tailwind 3 — each verified with the tool that loads it (production build, Prisma CLI, CSS output, full test suite). CI fails on any high or critical advisory. Remaining major upgrades (Next 16, Prisma 7, Tailwind 4) are maintenance, not open advisories. The 1 MB JSON body cap remains as defence in depth.

## Reporting

Publish a security contact (e.g. `security.txt`) before launch.
