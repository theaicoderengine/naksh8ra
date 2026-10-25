# AI provider access: platform grants and organisation keys (BYOK)

Every AI operation in the product goes through one tenant-aware resolver, `src/server/ai/access.ts`. No service calls a provider SDK directly.

## Two kinds of credentials

| | Platform-owned (deployment) | Organisation-owned (BYOK) |
|---|---|---|
| Where | Environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (+ speech: `STT_PROVIDER`, `DEEPGRAM_API_KEY`, `TTS_PROVIDER`, `ELEVENLABS_API_KEY`) | `OrgAiCredential`, AES-256-GCM encrypted with `ENCRYPTION_KEY` |
| Who can use it | Only organisations (or personal/student accounts) a **platform super-admin** has granted, per **provider + capability** | Only the organisation that connected it |
| Who manages it | Operators (env) + super-admins (grants, Admin → AI access) | Organisation owners and HR admins (`ai.manage`), Settings → AI providers |
| Providers | Anthropic, OpenAI, Gemini; speech: OpenAI/Deepgram STT, OpenAI/ElevenLabs TTS | Gemini, OpenAI, Anthropic (text generation only) |

A new organisation has **no** platform AI. Grants live in `PlatformAiGrant` and cannot be written from an organisation's database context (row-level security allows organisations to read their own grants only).

## Capabilities

| Capability | Scope | Used by |
|---|---|---|
| `JOB_DRAFTING` | organisation | AI job description draft (always human-reviewed) |
| `QUESTION_GENERATION` | organisation | Suggested questions in the template editor; adaptive questions at interview start |
| `INTERVIEW_CONVERSATION` | organisation | Conversational interviewer turns |
| `ASSESSMENT` | organisation | Evidence-based assessment (worker) |
| `RESUME_PARSING` | personal | Student resume extraction (worker; falls back to basic extraction when unavailable) |
| `PRACTICE_COACHING` | personal | Practice questions and feedback |
| `TRANSCRIPTION` | both | Speech-to-text for spoken answers |
| `SPEECH_SYNTHESIS` | both | Server-side interviewer voice (otherwise the browser's own voice is used) |

Candidate summaries are part of the assessment output (`ASSESSMENT`); there is no separate summary call.

## Resolution order (per operation)

For organisation scope:

1. **Explicit selection** (`OrgAiRoute`) for the capability:
   - *Your key* → that provider's organisation key; if missing or invalid → `PROVIDER_NOT_CONFIGURED`.
   - *Platform provider X* → the deployment key for X, only with an enabled grant; model must be permitted.
   An unusable selection fails. It never falls back to anything else.
2. **No selection** → the organisation's active key (the earliest connected if several).
3. Otherwise a **platform** key where a grant exists for this capability (the deployment default provider if granted, otherwise the single granted one; deterministic order if several).
4. Otherwise `AI_ACCESS_DENIED` (no grant) or `PROVIDER_NOT_CONFIGURED` (granted, but the deployment key is missing).

Personal scope (students) uses step 3 only, with grants on the `PERSONAL` subject. Students never use an employer's key or grant.

Never: another organisation's key; another provider after a failure; a different (e.g. paid) model after a quota error; a platform key without a grant.

**Re-checked on every operation**, including background jobs at the moment they run. Revoking a grant or removing a key stops the next operation, including queued jobs that have not started. The worker derives the organisation from the database row it processes (e.g. the interview session), not from the job payload alone.

**No shared clients.** Keys are decrypted and SDK clients created per operation, so nothing cached can carry one organisation's credential into another's request. Empty keys are refused before reaching an SDK, because the Anthropic, OpenAI and Google SDKs otherwise read their own `*_API_KEY` environment variables — which would silently use the platform's key.

## Speech

Speech uses deployment speech providers only and needs its own grant (`TRANSCRIPTION`, `SPEECH_SYNTHESIS`). A text-generation key never enables speech. Without authorised transcription:
- interviews that allow typed answers run **typed-only**, and the candidate is told spoken answers are unavailable;
- interviews that require audio cannot start (clear message; invitation remains valid).
Without authorised server TTS, the browser's built-in voice is used (not a platform-funded service).

## Models

`src/server/ai/catalog.ts` holds the supported model list, adjustable with `AI_MODEL_CATALOG_JSON` (add, re-label, remove). Every selection is validated against it, and connection tests confirm the model exists for the key (`models.retrieve` / Gemini `models.get` incl. `generateContent` support). Platform grants can restrict models (`allowedModels`); empty means the deployment default models only.

### Gemini and free tier

- Integrated with Google's official `@google/genai` SDK (Gemini API / AI Studio keys; Vertex is explicitly disabled). Structured output via `responseMimeType: application/json` + `responseJsonSchema`, validated with Zod.
- Timeouts (`AI_TIMEOUT_MS`); automatic retries for 408/5xx only (3 attempts, exponential backoff). **429 is never retried**, so retries don't burn quota.
- Quota/rate-limit errors return `PROVIDER_QUOTA_EXCEEDED` with a message explaining free-tier quotas; the request is not moved to another model or provider.
- The catalogue marks models as *free-tier eligible*, *paid*, or *check provider plan*, as published by Google at the time of writing. This is informational: quotas, availability, billing status and data-use terms (free-tier prompts may be used to improve Google's products) differ by tier and change over time. The UI says so; nothing promises free or unlimited use.

## Organisation key lifecycle

- **Connect / rotate / change model:** the key is tested first (no content generated); a failing key is never stored. Stored encrypted with last-4 characters and a short SHA-256 fingerprint for display. `version` increments on every change.
- **Re-test:** updates last validation time; authentication or missing-model failures mark the key `INVALID`.
- **At use time:** an authentication failure marks the key `INVALID`; quota errors are recorded as the last error but keep it active.
- **Remove:** deletes the key. Capabilities explicitly set to it then fail clearly until changed; nothing switches to platform AI automatically.
- Raw keys are never returned by any API, page or log.

## Usage, limits and cost

- `AiRequestLog`: one row per operation attempt — organisation/user/session, capability, provider, model, source (organisation/platform), credential id + version, status (`SUCCEEDED` / `FAILED` / `DENIED`), error code, input/output tokens where reported, latency, **estimated** cost (only when a price is configured in `PROVIDER_PRICES_JSON`/defaults; otherwise blank — never guessed). No prompts or outputs are stored.
- Platform grants can set monthly request and token limits. A request is reserved atomically in `AiUsageCounter` (re-checking the grant under a row lock) before the provider call, so concurrent requests and retries cannot exceed the request limit; token limits stop further calls once reached (the call that crosses the limit completes). Each operation reserves once; SDK-level retries happen inside it. Failed attempts count toward request limits.
- Personal-account limits are shared by all personal accounts.
- Interview credits are unchanged: reserved at invitation, consumed at completion with ≥1 answer, released on cancellation/expiry/platform failure. A failed or denied AI assessment leaves the session `FAILED` with the reason (never `ASSESSED`), retryable by HR, and never consumes an extra credit.

## Interfaces

Organisation (`ai.manage`, held by OWNER and HR_ADMIN):
`GET /api/v1/ai/settings`, `POST /ai/credentials/{provider}/test-key`, `PUT|DELETE /ai/credentials/{provider}`, `POST /ai/credentials/{provider}/test`, `PUT /ai/routes`.

Platform (`platform.ai.view`: SUPER_ADMIN, BILLING_ADMIN; `platform.ai.manage`: SUPER_ADMIN only; MFA required; enforced in the route layer and again in the service):
`GET /api/v1/platform/ai`, `GET /platform/organisations/{id}/ai`, `PUT /platform/organisations/{id}/ai/grants`, `GET /platform/ai/personal`, `PUT /platform/ai/personal/grants`. Every grant change requires a reason and writes an audit event with before/after values.

## Operations

1. Configure deployment keys (optional) and `ENCRYPTION_KEY` (required to store organisation keys).
2. Run `npm run db:seed` after deploying (adds the `ai.manage` permission to system roles).
3. Grant platform AI per organisation in Admin → AI access, with limits; grant personal-account AI for student practice if offered.
4. Rotating `ENCRYPTION_KEY` makes stored organisation keys unreadable — organisations would need to reconnect. Plan key rotation as a re-encryption migration.
