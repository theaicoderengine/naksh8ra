# Known limitations and follow-ups

This is a frank list of what is incomplete, unverified or simplified as of handover. Items marked **launch blocker** must be resolved before real candidates use the system.

## Unverified integrations

| Item | Status | Severity |
|---|---|---|
| Live LLM (Anthropic / OpenAI) | Adapters implemented and type-checked; **never called with a real key** from this environment. All interview/assessment tests use the deterministic fixture provider. | **Launch blocker:** verify on staging |
| Live STT / server TTS (OpenAI, Deepgram, ElevenLabs) | Same: implemented, not exercised. Accuracy across accents/dialects unmeasured. | **Launch blocker** |
| Stripe | Webhook handling tested with locally signed payloads; Checkout/Portal API calls not exercised against Stripe. | **Launch blocker** for paid plans |
| Email providers (SMTP/Resend/Postmark) | Only the console provider was exercised. | **Launch blocker** |
| S3 storage | Only local storage exercised. | **Launch blocker** for multi-node |
| ClamAV scanning | Adapter implemented; not run. Without it, uploads are stored as `NOT_SCANNED`. | **Launch blocker** for public uploads |

## AI provider access (BYOK / platform grants)

- **Launch blocker — live providers unverified.** No organisation or platform key has been exercised against live Gemini, OpenAI or Anthropic services. Gemini behaviour is tested with Google's official SDK over a stubbed HTTP transport; Anthropic/OpenAI request shapes are verified by capturing real SDK requests against a stub. Run [staging-provider-test-matrix.md](staging-provider-test-matrix.md) (currently: not run).
- **Rollback hazard.** Rolling the app back to a release before the AI access feature re-opens platform AI to every organisation (older code has no grant checks). The schema itself is rollback-compatible. Procedure in [operations.md](operations.md#rollback) (set `LLM_PROVIDER=none` / remove platform AI keys for the old release).
- Free-tier labels are advisory, from Google's published model list at the time of writing, and configurable — not fetched live.
- Token reservations use a conservative size estimate (≈3 bytes/token + output cap). Near a token limit, a request may be refused even though its actual usage would have fitted; limits never overshoot through concurrency. Orphaned reservations are charged their full estimate until a late settle corrects them.
- Each attempt (including retries and failed attempts) counts as one request against request limits.
- Personal-account (student) platform limits are shared across all personal accounts, not per student (practice credits still cap each student).
- Organisation keys cover text generation only; no BYOK for speech-to-text or text-to-speech.
- Cost estimates exist only for models with configured prices (Anthropic defaults); Gemini/OpenAI show "n/a" until `PROVIDER_PRICES_JSON` is set.
- A short (48-bit) SHA-256 fingerprint of each organisation key is shown to the organisation and platform admins for identification; it does not enable key recovery for high-entropy keys.
- Platform deployments cannot route provider traffic through a proxy/gateway: SDK base-URL variables are deliberately ignored. Adding gateway support needs an explicit, platform-only configuration.

## Hostinger deployment

- **Rehearsed, not yet run on Hostinger.** CI and a local rehearsal (`scripts/hostinger/rehearse.sh`) ran the Hostinger build, start-up and checks against local PostgreSQL 16, an S3 API emulator (moto) and an SMTP sink. Not yet exercised: Hostinger's build environment, a managed PostgreSQL pooler (Prisma was tested with `pgbouncer=true` against direct PostgreSQL, not through PgBouncer), Cloudflare R2, the hPanel cron job and live email/Stripe/AI providers.
- **No malware scanning** on web hosting (no ClamAV). Uploads are content-type checked and shown as "not scanned"; production requires `ALLOW_UNSCANNED_UPLOADS=true`. **Launch blocker** for large-scale public uploads unless an external clamd is connected.
- Background jobs run inside the single web process. After an idle stop they resume on the next cron tick (≤ 1 min); an interrupted job restarts after its 10-minute lease.
- API requests are capped at 100 s (`REQUEST_DEADLINE_MS`, below Hostinger's 120 s limit); an AI call that cannot finish in time fails with a retryable message.

## Product scope simplifications

- **Conversational mode is turn-based, not full-duplex streaming.** Each candidate utterance is recorded (silence detection), uploaded, transcribed, answered by the LLM, then spoken. Expect a few seconds of latency per turn with real providers; barge-in (interrupting the interviewer) is not supported. A realtime WebRTC provider integration would need a new adapter with ephemeral client tokens.
- **SSO (SAML/OIDC) and SCIM** are not implemented (`feature.sso` entitlement exists for the future).
- **Integrations** (ATS/HRIS export, calendar, outbound webhooks): data model (`IntegrationConnection`, `WebhookEvent`) exists; no connectors or management UI beyond CSV export.
- **Support access grants** are requested/approved/expire and are audited, but no support-only data view exists — approval does not unlock anything yet (deliberately conservative).
- **Breached-password check** (e.g. k-anonymity lookup) not implemented; policy is length + character classes.
- **Error tracking:** `SENTRY_DSN` is reserved but no SDK is wired; rely on structured logs.
- **Internationalisation:** UI is English only; interview language is configurable per template (depends on provider language support).
- **Email templates** are plain and functional, not brand-designed.
- **Legal pages** are templates; candidate notices and terms need counsel review. **Launch blocker.**
- **Analytics** are operational counts (pipeline, time-in-stage, interview completion); no adverse-impact reporting.

## Responsible AI

- No validation study or bias/adverse-impact audit has been performed (see [responsible-ai.md](responsible-ai.md)). Several jurisdictions require one before automated tools are used in hiring decisions. **Launch blocker** where applicable.

## Security / dependencies

- `npm audit` reports 0 vulnerabilities (2026-10-25) using `overrides` for patched transitive packages (`postcss` in Next, `deepmerge-ts` in Prisma's config loader, `postcss-selector-parser` under Tailwind 3). Overrides must be re-checked on every Next/Prisma/Tailwind upgrade; the majors (Next 16, Prisma 7, Tailwind 4) are pending maintenance.
- `postcss` 8.5.31 was locked at the original build while under two weeks old (patch release); acceptable, noted for supply-chain review.
- RLS context is set by the app role itself (see [security.md](security.md#tenant-isolation)); RLS guards against application bugs, not a compromised app process.
- No independent penetration test has been performed. **Launch blocker** (recommended by policy).
- CSP allows `'unsafe-inline'` scripts (required by Next.js without nonces). Moving to nonce-based CSP is a hardening follow-up.

## Testing gaps

- E2E covers the structured interview mode in the browser; conversational mode is covered by an integration test (server pipeline) but not a browser test.
- Load tests ran on a single local machine with fixture providers; they measure application + database overhead only, not provider latency or multi-node behaviour.
- The Docker images were built and smoke-tested in this environment using the full `node:22-bookworm` base (the default `-slim` base needs Debian mirrors, which this sandbox's network policy blocks). `docker compose up` as a whole was not run here.
- CI (`.github/workflows/ci.yml`) runs on GitHub on every push. Runs 1–3 failed (integration lockout test vs the job-wide `RATE_LIMIT_MULTIPLIER`, fixed in 87fbcff); run 4 passed the test job and failed only the container job (unresolvable Trivy action tag, replaced by the pinned Trivy image). See the Actions tab for the current head.
- AWS infrastructure (`infra/aws`) and the deploy workflow are validated (`terraform validate`, YAML lint) but have never been applied or run: no AWS account was available. See [deployment-aws.md](deployment-aws.md).
- The upgrade path was rehearsed on a local copy of the previous release's database, not on a real staging database with production-like data volume; migration lock time on large tables is unmeasured (the AI migrations only add tables, two columns with defaults, and policies).
- Accessibility: built on semantic HTML, labelled controls, focus states and keyboard paths; no formal WCAG audit or screen-reader testing was done.
