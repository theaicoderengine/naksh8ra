// Test environment: isolated database, inline queue, deterministic fixture AI providers.
const db = process.env.TEST_DATABASE_URL ?? "postgresql://atlas_app:atlas_app_dev@localhost:5432/atlas_test?schema=public";
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: db,
  QUEUE_MODE: "inline",
  REDIS_URL: "",
  LLM_PROVIDER: "fixture",
  STT_PROVIDER: "fixture",
  TTS_PROVIDER: "browser",
  ALLOW_FIXTURE_PROVIDERS: "true",
  EMAIL_PROVIDER: "console",
  STORAGE_PROVIDER: "local",
  STORAGE_LOCAL_DIR: "./tmp/test-storage",
  PAYMENT_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_test_offline_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  LOG_LEVEL: "silent",
  PLATFORM_ADMIN_EMAILS: "",
});
