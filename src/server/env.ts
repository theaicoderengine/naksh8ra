import { z } from "zod";

// Mirrors AMBIENT_SDK_ENV in providers/llm (kept here to avoid an import cycle).
const AMBIENT_SDK_ENV = ["ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_IDENTITY_TOKEN", "ANTHROPIC_IDENTITY_TOKEN_FILE", "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ENVIRONMENT_ID", "ANTHROPIC_ENVIRONMENT_KEY", "ANTHROPIC_CONFIG_DIR", "AZURE_OPENAI_API_KEY", "GOOGLE_GENAI_USE_ENTERPRISE", "GOOGLE_VERTEX_BASE_URL"];

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().default("Atlas Hiring"),
  APP_SUPPORT_EMAIL: z.string().email().default("support@example.com"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  QUEUE_MODE: z.enum(["redis", "postgres", "inline"]).default("redis"),
  // Postgres queue: the web process works through jobs; an external cron calls
  // /api/internal/jobs/tick with CRON_SECRET to wake an idle site and schedule recurring jobs.
  JOB_RUNNER_IN_PROCESS: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  JOB_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  CRON_SECRET: z.string().optional(),

  // 32-byte key, base64. Encrypts MFA secrets and integration secrets at rest.
  ENCRYPTION_KEY: z.string().optional(),
  // Only during a key rotation: the old key, accepted for decryption until
  // `npm run secrets:reencrypt -- --apply` has moved every secret to ENCRYPTION_KEY.
  ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().default(24 * 7),
  PRIVILEGED_SESSION_TTL_HOURS: z.coerce.number().default(12),

  // AI providers
  // Deployment default for platform-funded AI. Organisations still need an explicit
  // platform grant (per provider + capability) to use any deployment credential.
  LLM_PROVIDER: z.enum(["anthropic", "openai", "gemini", "fixture", "none"]).default("none"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_FAST_MODEL: z.string().default("claude-haiku-5-5"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_FAST_MODEL: z.string().default("gemini-2.5-flash-lite"),
  STT_PROVIDER: z.enum(["openai", "deepgram", "fixture", "none"]).default("none"),
  DEEPGRAM_API_KEY: z.string().optional(),
  OPENAI_STT_MODEL: z.string().default("whisper-1"),
  TTS_PROVIDER: z.enum(["openai", "elevenlabs", "browser", "none"]).default("browser"),
  OPENAI_TTS_MODEL: z.string().default("tts-1"),
  OPENAI_TTS_VOICE: z.string().default("alloy"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  // Fixture providers produce deterministic output for tests. They are refused
  // in production and every session that used them is labelled FIXTURE in the UI.
  ALLOW_FIXTURE_PROVIDERS: bool,
  AI_TIMEOUT_MS: z.coerce.number().default(60_000),
  // Retries of transient provider errors (5xx/timeouts), each a separately reserved attempt.
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_RETRY_BASE_MS: z.coerce.number().int().min(0).max(60_000).default(1000),
  // Total time an API request may spend, including provider calls and retries. Keep it below the
  // host's request cut-off (Hostinger: 120 s). 0 disables (background jobs never have one).
  REQUEST_DEADLINE_MS: z.coerce.number().int().min(0).default(100_000),

  // Storage
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  // Server-side encryption header. "none" for S3-compatible stores that encrypt at rest by
  // default and reject the header (e.g. Cloudflare R2).
  S3_SSE: z.enum(["AES256", "none"]).default("AES256"),
  // Production refuses local disk storage (redeploys and multiple nodes lose files) unless set.
  ALLOW_LOCAL_STORAGE: bool,
  // Production refuses MALWARE_SCANNER=none unless this explicit acknowledgement is set;
  // uploads are then stored and shown as "not scanned".
  ALLOW_UNSCANNED_UPLOADS: bool,
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  MALWARE_SCANNER: z.enum(["clamav", "none"]).default("none"),
  CLAMAV_HOST: z.string().default("localhost"),
  CLAMAV_PORT: z.coerce.number().default(3310),

  // Email
  EMAIL_PROVIDER: z.enum(["console", "smtp", "resend", "postmark"]).default("console"),
  EMAIL_FROM: z.string().default("Atlas Hiring <no-reply@example.com>"),
  SMTP_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  EMAIL_WEBHOOK_SECRET: z.string().optional(),

  // Payments
  PAYMENT_PROVIDER: z.enum(["stripe", "none"]).default("none"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Observability
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SENTRY_DSN: z.string().optional(),

  // Bootstrap
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  TRUST_PROXY: bool,
  // Number of trusted proxies that append to X-Forwarded-For (see clientIp in http/route.ts).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;
  // AI SDK variables that would attach platform configuration to organisation-key
  // requests (see src/server/providers/llm). Fail closed at start-up.
  const ambient = AMBIENT_SDK_ENV.filter((k) => !!process.env[k]);
  if (ambient.length) throw new Error(`Unsupported AI SDK environment variables are set: ${ambient.join(", ")}. Remove them.`);
  if (e.APP_ENV === "production" || e.APP_ENV === "staging") {
    if (!e.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required outside development");
    // Jobs must be durable and retried: never silently run them inside requests.
    if (e.QUEUE_MODE === "inline") throw new Error("QUEUE_MODE=inline is for tests and local development; use postgres or redis");
    if (e.QUEUE_MODE === "redis" && !e.REDIS_URL) throw new Error("QUEUE_MODE=redis requires REDIS_URL (or use QUEUE_MODE=postgres)");
    if (e.QUEUE_MODE === "postgres" && (!e.CRON_SECRET || e.CRON_SECRET.length < 32)) {
      throw new Error("QUEUE_MODE=postgres requires CRON_SECRET (at least 32 characters) for the scheduled job tick");
    }
  }
  if (e.APP_ENV === "production") {
    if (e.STORAGE_PROVIDER === "local" && !e.ALLOW_LOCAL_STORAGE) {
      throw new Error("STORAGE_PROVIDER=local is not allowed in production (files are lost on redeploy); use s3, or set ALLOW_LOCAL_STORAGE=true for a single persistent server");
    }
    if (e.STORAGE_PROVIDER === "s3" && !e.S3_BUCKET) throw new Error("STORAGE_PROVIDER=s3 requires S3_BUCKET");
    if (e.MALWARE_SCANNER === "none" && !e.ALLOW_UNSCANNED_UPLOADS) {
      throw new Error("MALWARE_SCANNER=none in production requires ALLOW_UNSCANNED_UPLOADS=true (uploads are then labelled 'not scanned'), or configure clamav");
    }
    if (!e.APP_URL.startsWith("https://")) throw new Error("APP_URL must be the public https:// origin in production");
  }
  for (const [name, v] of [["ENCRYPTION_KEY", e.ENCRYPTION_KEY], ["ENCRYPTION_KEY_PREVIOUS", e.ENCRYPTION_KEY_PREVIOUS]] as const) {
    if (v && Buffer.from(v, "base64").length !== 32) throw new Error(`${name} must be 32 random bytes, base64-encoded`);
  }
  if (e.ENCRYPTION_KEY_PREVIOUS && e.ENCRYPTION_KEY_PREVIOUS === e.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY_PREVIOUS must differ from ENCRYPTION_KEY");
  if (e.ALLOW_FIXTURE_PROVIDERS && e.APP_ENV === "production") {
    throw new Error("ALLOW_FIXTURE_PROVIDERS must not be enabled in production");
  }
  cached = e;
  return e;
}

/** For tests that mutate process.env. */
export function resetEnvCache() {
  cached = null;
}

export const isProd = () => env().APP_ENV === "production";
