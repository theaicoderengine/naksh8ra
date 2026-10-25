import { z } from "zod";

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
  QUEUE_MODE: z.enum(["redis", "inline"]).default("redis"),

  // 32-byte key, base64. Encrypts MFA secrets and integration secrets at rest.
  ENCRYPTION_KEY: z.string().optional(),
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

  // Storage
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
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
  if (e.APP_ENV === "production" || e.APP_ENV === "staging") {
    if (!e.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required outside development");
    if (e.ALLOW_FIXTURE_PROVIDERS && e.APP_ENV === "production") {
      throw new Error("ALLOW_FIXTURE_PROVIDERS must not be enabled in production");
    }
  }
  cached = e;
  return e;
}

/** For tests that mutate process.env. */
export function resetEnvCache() {
  cached = null;
}

export const isProd = () => env().APP_ENV === "production";
