# Staging test matrix: live AI providers

**Status: NOT RUN.** No live Gemini, OpenAI or Anthropic credentials were available when this matrix was written. Every result cell below is a placeholder to be filled in on staging by a person holding test credentials. Do not mark a row passed without evidence (request id from `x-request-id`, `AiRequestLog` row id, screenshot or provider dashboard entry).

## Setup

| Item | Value |
|---|---|
| Environment | Staging, `APP_ENV=staging`, real `ENCRYPTION_KEY`, `QUEUE_MODE=redis` with worker running |
| Organisations | **Org A** (BYOK only), **Org B** (platform grants only), **Org C** (both), **Org D** (nothing) |
| Platform keys | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — low-limit test keys/projects |
| Organisation keys | One per provider, from **separate** provider accounts/projects (to tell billing apart) |
| Gemini free tier | One AI Studio project on the **free tier** (no billing), one on a **paid** tier |
| Evidence | Record request id + `AiRequestLog.id` + provider dashboard usage for every row |

Run `npm run db:verify-ai-access -- --expect-no-grants` before granting anything.

## Matrix

Columns: G = Gemini, O = OpenAI, A = Anthropic. Fill each cell with PASS / FAIL + evidence, or N/A.

### Connection and keys (Settings → AI providers, Org A)

| # | Scenario | Expected | G | O | A |
|---|---|---|---|---|---|
| 1 | Test connection with a valid key + supported model | "Connected …"; nothing stored | not run | not run | not run |
| 2 | Test & activate valid key | Active, masked `••••xxxx`, validated time set; audit `ai.credential.connected` | not run | not run | not run |
| 3 | Invalid key (revoked / typo) | "rejected the API key"; key **not** stored | not run | not run | not run |
| 4 | Valid key, model the key cannot access | "model is not available to this key"; not stored | not run | not run | not run |
| 5 | Model not in platform catalogue (API call with arbitrary id) | 422 `unsupported_model` | not run | not run | not run |
| 6 | Re-test stored key after revoking it at the provider | Status INVALID, last error shown; next operation fails clearly | not run | not run | not run |
| 7 | Rotate: replace key with a second valid key | version +1, new mask; next operation logs new `credentialVersion` | not run | not run | not run |
| 8 | Remove key while a capability explicitly selects it | That capability fails with "reconnect"; **no** platform usage logged | not run | not run | not run |
| 9 | Raw key never visible: page source, API responses, server logs, `AiRequestLog`, audit metadata | Absent everywhere | not run | not run | not run |

### Real operations (Org A on its own key)

| # | Scenario | Expected | G | O | A |
|---|---|---|---|---|---|
| 10 | AI job description draft | Valid draft; `AiRequestLog` SUCCEEDED, source ORGANISATION, tokens recorded | not run | not run | not run |
| 11 | Generate interview questions | Valid questions | not run | not run | not run |
| 12 | Structured interview → assessment (worker) | ASSESSED/REQUIRES_REVIEW; evidence verified; tokens logged | not run | not run | not run |
| 13 | Conversational interview (5+ turns) | Coherent turns; plan enforced; turn latency recorded (p50/p95) | not run | not run | not run |
| 14 | Output parsing: structured JSON accepted for each capability | No `invalid_output` failures over 20 calls | not run | not run | not run |

### Platform grants (Org B, Org D)

| # | Scenario | Expected | G | O | A |
|---|---|---|---|---|---|
| 15 | Org D (no grants, no keys) tries every capability | `AI_ACCESS_DENIED`; no provider call (provider dashboard shows none) | not run | not run | not run |
| 16 | Grant one capability to Org B | Only that capability works; source PLATFORM | not run | not run | not run |
| 17 | Allowed-models restriction; org selects a non-permitted model | Refused; permitted model works | not run | not run | not run |
| 18 | Revoke while an assessment job is queued (stop worker, complete interview, revoke, start worker) | Job fails `AI_ACCESS_DENIED`; no provider call | not run | not run | not run |
| 19 | Request limit = 5; fire 20 concurrent drafts | Exactly 5 reach the provider (dashboard + log) | not run | not run | not run |
| 20 | Token limit sized for ~3 requests; 10 concurrent | ≤ limit settled; no request beyond reservation; `tokensReserved` returns to 0 | not run | not run | not run |
| 21 | Org C with both: org key used by default; platform only where explicitly selected | Matches selection; never switches after an org-key error | not run | not run | not run |

### Quotas, retries and failures

| # | Scenario | Expected | G | O | A |
|---|---|---|---|---|---|
| 22 | **Gemini free tier**: exhaust quota (low-RPM model, burst) | `PROVIDER_QUOTA_EXCEEDED` with free-tier message; 1 attempt (no retry); **no other model or provider called**; candidate sees neutral message | not run | N/A | N/A |
| 23 | Provider rate limit (429) on paid key | Reported; not retried; no fallback | not run | not run | not run |
| 24 | Transient 5xx/timeout (provider incident, or `AI_TIMEOUT_MS=1000` on a long assessment) | Up to `AI_MAX_RETRIES` attempts logged with `attempt` 1..n; each reserved/settled | not run | not run | not run |
| 25 | Kill the worker mid-assessment | Reservation swept after expiry; counter consistent; job retried by queue | not run | not run | not run |
| 26 | Refusal / safety block | Reported as refusal; no model switch | not run | not run | not run |

### Speech (platform only)

| # | Scenario | Expected | Result |
|---|---|---|---|
| 27 | STT not granted, template allows typing | Interview runs typed-only with explanation | not run |
| 28 | STT granted (OpenAI/Deepgram): spoken answers on 3 accents / noisy audio | Transcripts usable; logged | not run |
| 29 | TTS granted (OpenAI/ElevenLabs) vs not granted | Server voice vs browser voice | not run |

### Concurrency and load (staging hardware)

| # | Scenario | Expected | Result |
|---|---|---|---|
| 30 | `PERF_INTERVIEWS=50` with real providers, mixed org keys and platform grants | Error rate, p50/p95 per step recorded; no cross-tenant usage in logs | not run |
| 31 | 3 organisations concurrently on their own keys of the same provider | Each `AiRequestLog.credentialId` belongs to its own organisation; provider dashboards show usage on the right accounts | not run |

## Sign-off

| Role | Name | Date | Notes |
|---|---|---|---|
| Engineering | | | |
| Security | | | |
| HR / assessment owner | | | |
