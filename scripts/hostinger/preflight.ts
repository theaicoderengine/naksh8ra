/**
 * Deployment preflight for Hostinger (run by `npm run build` when DEPLOY_TARGET=hostinger, or
 * by hand: `npx tsx scripts/hostinger/preflight.ts`). Fails the deployment, before anything is
 * changed, when configuration would make the app unsafe or silently broken. Prints check names
 * and outcomes only — never secret values.
 *
 * Live checks: both database roles connect; the runtime role cannot bypass row-level security
 * and is not the schema owner; object storage accepts a write/read/delete.
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

type Result = { name: string; ok: boolean; detail?: string; warn?: boolean };
const results: Result[] = [];
const pass = (name: string, detail?: string) => results.push({ name, ok: true, detail });
const fail = (name: string, detail: string) => results.push({ name, ok: false, detail });
const warn = (name: string, detail: string) => results.push({ name, ok: true, warn: true, detail });

function dbUser(url: string | undefined) {
  try {
    return url ? decodeURIComponent(new URL(url).username) : null;
  } catch {
    return null;
  }
}

async function main() {
  // 1. Static configuration (the same validation the app runs at start-up).
  const { env } = await import("../../src/server/env");
  let e: ReturnType<typeof env>;
  try {
    e = env();
    pass("environment variables valid");
  } catch (err) {
    fail("environment variables valid", (err as Error).message);
    return;
  }
  if (e.APP_ENV !== "production" && e.APP_ENV !== "staging") fail("APP_ENV", "must be production or staging on Hostinger");
  else pass("APP_ENV", e.APP_ENV);
  if (e.QUEUE_MODE !== "postgres") fail("QUEUE_MODE", "must be postgres on Hostinger (no worker processes)");
  else pass("QUEUE_MODE", "postgres (in-process runner + cron tick)");
  if (e.STORAGE_PROVIDER !== "s3") fail("STORAGE_PROVIDER", "must be s3 on Hostinger: the deploy folder is replaced on redeploy");
  if (process.env.NODE_ENV && process.env.NODE_ENV !== "production") warn("NODE_ENV", `is "${process.env.NODE_ENV}"; leave it unset in hPanel (the build and start commands set it)`);
  if (!e.TRUST_PROXY) warn("TRUST_PROXY", "not set: rate limits will key on the proxy's address instead of the visitor's");
  if (e.EMAIL_PROVIDER === "console") {
    if (e.APP_ENV === "production") fail("EMAIL_PROVIDER", "console does not send email (verification, invitations, resets would never arrive)");
    else warn("EMAIL_PROVIDER", "console: emails are only logged");
  } else if (e.EMAIL_PROVIDER === "postmark" && !e.POSTMARK_SERVER_TOKEN) fail("EMAIL_PROVIDER", "postmark requires POSTMARK_SERVER_TOKEN");
  else if (e.EMAIL_PROVIDER === "resend" && !e.RESEND_API_KEY) fail("EMAIL_PROVIDER", "resend requires RESEND_API_KEY");
  else if (e.EMAIL_PROVIDER === "smtp" && !e.SMTP_URL) fail("EMAIL_PROVIDER", "smtp requires SMTP_URL");
  else pass("EMAIL_PROVIDER", e.EMAIL_PROVIDER);
  if (e.PAYMENT_PROVIDER === "stripe") {
    if (!e.STRIPE_SECRET_KEY || !e.STRIPE_WEBHOOK_SECRET) fail("Stripe", "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required");
    else if (e.STRIPE_SECRET_KEY.startsWith("sk_live_") && process.env.STRIPE_LIVE_APPROVED !== "true") fail("Stripe", "live key set without STRIPE_LIVE_APPROVED=true (use test mode until live payments are authorised)");
    else pass("Stripe", e.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "LIVE mode (approved)" : "test mode");
  } else pass("Stripe", "payments disabled");
  const platformKey = { anthropic: e.ANTHROPIC_API_KEY, openai: e.OPENAI_API_KEY, gemini: e.GEMINI_API_KEY } as Record<string, string | undefined>;
  if (e.LLM_PROVIDER !== "none" && !platformKey[e.LLM_PROVIDER]) fail("LLM_PROVIDER", `${e.LLM_PROVIDER} selected but its API key is not set`);
  else pass("Platform AI", e.LLM_PROVIDER === "none" ? "off (organisations can still use their own keys)" : `${e.LLM_PROVIDER} (only for organisations with a platform grant)`);
  if (e.MALWARE_SCANNER === "none") warn("Malware scanning", "not available on Hostinger: uploads are stored and shown as 'not scanned'");
  if (e.REQUEST_DEADLINE_MS === 0 || e.REQUEST_DEADLINE_MS > 110_000) fail("REQUEST_DEADLINE_MS", "must be between 1 and 110000 (Hostinger stops requests after 120 s)");
  else pass("REQUEST_DEADLINE_MS", String(e.REQUEST_DEADLINE_MS));

  // 2. Database roles.
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl) fail("MIGRATION_DATABASE_URL", "required (owner role, direct non-pooled connection) for migrations");
  const appUser = dbUser(e.DATABASE_URL);
  const ownerUser = dbUser(migrationUrl);
  if (appUser && ownerUser && appUser === ownerUser) fail("database roles", "DATABASE_URL must use the runtime role (atlas_app), not the owner role used for migrations");
  if (/pooler|:6543\b/.test(e.DATABASE_URL) && !/[?&]pgbouncer=true\b/.test(e.DATABASE_URL)) fail("DATABASE_URL", "pooled connection without pgbouncer=true (Prisma needs it with transaction pooling)");
  if (!/[?&]connection_limit=\d+/.test(e.DATABASE_URL)) warn("DATABASE_URL", "no connection_limit; set e.g. connection_limit=5 to stay within the database plan");
  if (!/[?&]sslmode=(require|verify-full|verify-ca)\b/.test(e.DATABASE_URL) && !/localhost|127\.0\.0\.1/.test(e.DATABASE_URL)) fail("DATABASE_URL", "add sslmode=require: the database is reached over the internet");

  const app = new PrismaClient({ datasources: { db: { url: e.DATABASE_URL } } });
  try {
    const [r] = await app.$queryRaw<{ superuser: boolean; bypass: boolean; owner: boolean }[]>`
      SELECT r.rolsuper AS superuser, r.rolbypassrls AS bypass,
             pg_has_role(current_user, n.nspowner, 'USAGE') AS owner
      FROM pg_roles r, pg_namespace n WHERE r.rolname = current_user AND n.nspname = 'public'`;
    if (r.superuser || r.bypass) fail("runtime role", "DATABASE_URL role is SUPERUSER or BYPASSRLS: tenant isolation (RLS) would not apply");
    else if (r.owner) fail("runtime role", "DATABASE_URL role owns the schema: RLS can be disabled by it; use atlas_app");
    else pass("runtime role", "connects; cannot bypass row-level security");
  } catch (err) {
    fail("runtime role", `cannot connect with DATABASE_URL: ${(err as Error).message.split("\n")[0]}`);
  } finally {
    await app.$disconnect();
  }
  if (migrationUrl) {
    const owner = new PrismaClient({ datasources: { db: { url: migrationUrl } } });
    try {
      await owner.$queryRaw`SELECT 1`;
      pass("owner role", "connects");
    } catch (err) {
      fail("owner role", `cannot connect with MIGRATION_DATABASE_URL: ${(err as Error).message.split("\n")[0]}`);
    } finally {
      await owner.$disconnect();
    }
  }

  // 3. Object storage round trip.
  if (e.STORAGE_PROVIDER === "s3") {
    try {
      const { storage } = await import("../../src/server/providers/storage");
      const key = `preflight/${crypto.randomBytes(8).toString("hex")}.txt`;
      const body = Buffer.from(`atlas preflight ${new Date().toISOString()}`);
      await storage().put(key, body, "text/plain");
      const back = await storage().get(key);
      await storage().delete(key);
      if (!back.equals(body)) fail("object storage", "read-back mismatch");
      else pass("object storage", `write/read/delete OK (bucket ${e.S3_BUCKET})`);
    } catch (err) {
      fail("object storage", `${(err as Error).name}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
}

main()
  .catch((err) => fail("preflight", (err as Error).message))
  .finally(() => {
    for (const r of results) console.log(`${r.ok ? (r.warn ? "⚠" : "✔") : "✖"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      console.error(`\nPreflight failed (${failed.length}). Nothing was migrated or deployed.`);
      process.exit(1);
    }
    console.log("\nPreflight passed.");
  });
