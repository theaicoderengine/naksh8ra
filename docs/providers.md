# External providers

Every external dependency sits behind a small interface in `src/server/providers`, selected by environment variables. Admin → Health shows the active provider, mode (LIVE / FIXTURE / not configured) and model for each.

When a provider is not configured, the related feature fails closed with a clear `PROVIDER_NOT_CONFIGURED` (503) message — e.g. no AI interviews can be started, and AI job-description drafting is unavailable. Nothing pretends to work.

## Verification status (at handover)

| Capability | Adapters | Verified here | Notes |
|---|---|---|---|
| LLM (interviewer, assessment, JD drafts, resume parsing, practice) | `anthropic`, `openai`, `fixture` | **Fixture only** | No API keys were available. Anthropic adapter uses the Messages API with JSON-schema structured output; default model `claude-opus-5-5`, fast model `claude-haiku-5-5` (both configurable). |
| Speech-to-text | `openai` (whisper-1), `deepgram`, `fixture` | **Fixture only** | Fixture returns a canned transcript. |
| Text-to-speech | `browser` (Web Speech API, default), `openai`, `elevenlabs` | Browser speech exercised in E2E (headless Chromium); server TTS not verified | Voice quality of browser TTS varies by OS/browser. |
| Email | `console` (dev mailbox), `smtp`, `resend`, `postmark` | Console + SMTP code path (Mailpit in compose) not exercised in tests | Configure SPF/DKIM/DMARC for your sending domain. |
| Object storage | `local`, `s3` (AWS S3 or compatible) | Local only | Bucket must be private; presigned URLs expire in 60 s. |
| Malware scan | `clamav`, `none` | Not configured (files marked NOT_SCANNED) | Run `clamav/clamav` (compose profile `scan`). |
| Payments | `stripe`, `none` | Webhook handling with locally signed payloads only | See [billing.md](billing.md). |
| Queue | Redis/BullMQ, `inline` | Both (Redis worker container started and health-checked; tests use inline) | |

## Configuration

### LLM

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...            # server-side only
ANTHROPIC_MODEL=claude-opus-5-5
ANTHROPIC_FAST_MODEL=claude-haiku-5-5
AI_TIMEOUT_MS=60000
```
or `LLM_PROVIDER=openai` with `OPENAI_API_KEY` / `OPENAI_MODEL`. Usage is recorded per call in `UsageRecord`; cost estimates use `PROVIDER_PRICES_JSON` overrides (estimates only — verify against your contract).

Before launch: run representative interviews end-to-end on staging with the real model, review assessments against the rubric with HR reviewers, and check latency (the conversational turn path is STT → LLM → TTS sequentially).

### Speech

```env
STT_PROVIDER=openai              # or deepgram (DEEPGRAM_API_KEY)
TTS_PROVIDER=browser             # or openai / elevenlabs (ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID)
```

### Email

```env
EMAIL_PROVIDER=postmark          # or resend / smtp
POSTMARK_SERVER_TOKEN=...
EMAIL_FROM="Your Brand <no-reply@your-domain>"
EMAIL_WEBHOOK_SECRET=...         # bounce/complaint webhook → /api/v1/webhooks/email
```

### Storage

```env
STORAGE_PROVIDER=s3
S3_BUCKET=... S3_REGION=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=                     # for R2/MinIO/etc; S3_FORCE_PATH_STYLE=true for MinIO
```
Enable bucket encryption, block public access, versioning (for recovery) and a lifecycle rule consistent with your retention policy.

### Fixture providers

`LLM_PROVIDER=fixture` / `STT_PROVIDER=fixture` require `ALLOW_FIXTURE_PROVIDERS=true` and are refused when `APP_ENV=production`. Sessions run with fixtures are labelled **FIXTURE** in HR views. They exist for automated tests and local development only.
