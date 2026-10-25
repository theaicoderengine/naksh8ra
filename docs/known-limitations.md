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

- No organisation or platform key has been exercised against live Gemini, OpenAI or Anthropic services. Gemini behaviour (structured output, 429/5xx/auth handling, model checks) is tested with Google's official SDK over a stubbed HTTP transport; OpenAI and Anthropic connection tests use their SDKs' `models.retrieve` and are untested live. **Launch blocker:** verify each provider on staging.
- Free-tier eligibility labels come from Google's published model list at the time of writing and are configurable, not fetched live from the provider.
- Platform token limits are checked before each call; the call that crosses the limit completes, so usage can exceed a token limit by one operation.
- Personal-account (student) platform limits are shared across all personal accounts, not per student (practice credits still cap each student).
- Organisation keys cover text generation only; organisations cannot bring their own speech-to-text or text-to-speech keys.
- Cost estimates exist only for models with configured prices (Anthropic defaults); Gemini/OpenAI show "n/a" until `PROVIDER_PRICES_JSON` is set.
- Rotating `ENCRYPTION_KEY` requires a re-encryption step for stored organisation keys (not automated).

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

- `npm audit --omit=dev` reports 7 advisories (6 high, 1 moderate) whose fixes require major upgrades: `next` 15 → 16 (bundled `postcss`), `prisma` 6 → 7 (`deepmerge-ts`), `zod` 3 → 4 (memory exhaustion on oversized collections — mitigated by the 1 MB JSON cap), `openai` SDK 5 → 7. Plan the upgrades and re-run the full test suite.
- RLS context is set by the app role itself (see [security.md](security.md#tenant-isolation)); RLS guards against application bugs, not a compromised app process.
- No independent penetration test has been performed. **Recommended before launch.**
- CSP allows `'unsafe-inline'` scripts (required by Next.js without nonces). Moving to nonce-based CSP is a hardening follow-up.

## Testing gaps

- E2E covers the structured interview mode in the browser; conversational mode is covered by an integration test (server pipeline) but not a browser test.
- Load tests ran on a single local machine with fixture providers; they measure application + database overhead only, not provider latency or multi-node behaviour.
- The Docker images were built and smoke-tested in this environment using the full `node:22-bookworm` base (the default `-slim` base needs Debian mirrors, which this sandbox's network policy blocks). `docker compose up` as a whole was not run here.
- CI workflow (`.github/workflows/ci.yml`) has not run on GitHub yet; its steps were executed locally piecemeal.
- Accessibility: built on semantic HTML, labelled controls, focus states and keyboard paths; no formal WCAG audit or screen-reader testing was done.
