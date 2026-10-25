#!/usr/bin/env node
/**
 * Post-deployment verification against a live URL (no dependencies, Node 20+):
 *   node scripts/hostinger/verify-deployment.mjs https://hire.example.com [--cron-secret=...] [--allow-http]
 * Checks liveness, readiness (database + migrations), background-job health, the login page,
 * security headers, HTTP→HTTPS redirect, that anonymous API access and an unauthenticated cron
 * tick are refused, and (with --cron-secret) that the cron tick works. Exit 1 on any failure.
 */
const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith("--"))?.replace(/\/$/, "");
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const allowHttp = args.includes("--allow-http");
const cronSecret = opt("cron-secret") ?? process.env.CRON_SECRET;
if (!base) {
  console.error("usage: verify-deployment.mjs <base-url> [--cron-secret=...] [--allow-http]");
  process.exit(2);
}

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
  }
}
const get = (path, init = {}) => fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(30_000), ...init });
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

await check("liveness /api/health", async () => {
  const r = await get("/api/health");
  expect(r.status === 200, `status ${r.status}`);
  return "200";
});
await check("readiness /api/ready (database, migrations)", async () => {
  const r = await get("/api/ready");
  const body = await r.json().catch(() => ({}));
  expect(r.status === 200, `status ${r.status} ${JSON.stringify(body.checks ?? {})}`);
  expect(body.checks?.migrations !== "pending", "migrations pending");
  return JSON.stringify(body.checks);
});
await check("background jobs /api/health/jobs", async () => {
  const r = await get("/api/health/jobs");
  const body = await r.json().catch(() => ({}));
  expect(r.status === 200, `status ${r.status} ${JSON.stringify(body)} — is the cron tick configured?`);
  return `mode ${body.mode}, oldest due ${body.oldestDueSeconds ?? 0}s, runner seen ${body.lastRunnerSeenSeconds ?? "n/a"}s ago`;
});
await check("login page", async () => {
  const r = await get("/login");
  expect(r.status === 200, `status ${r.status}`);
  const h = r.headers;
  for (const k of ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy"]) expect(h.get(k), `missing ${k}`);
  if (!allowHttp) expect(h.get("strict-transport-security"), "missing strict-transport-security");
  expect(!h.get("x-powered-by"), "x-powered-by header exposed");
  return "200, security headers present";
});
if (!allowHttp) {
  await check("HTTPS enforced", async () => {
    expect(base.startsWith("https://"), "base URL is not https");
    const r = await fetch(base.replace(/^https:/, "http:") + "/api/health", { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    expect([301, 302, 307, 308].includes(r.status) && (r.headers.get("location") ?? "").startsWith("https://"), `http returned ${r.status}`);
    return `http → ${r.status} https`;
  });
}
await check("anonymous API access refused", async () => {
  const r = await get("/api/v1/organisations/current");
  expect(r.status === 401, `status ${r.status}`);
  return "401";
});
await check("cron tick refuses missing secret", async () => {
  const r = await get("/api/internal/jobs/tick", { method: "POST" });
  expect(r.status === 401, `status ${r.status} (404 means QUEUE_MODE is not postgres)`);
  return "401";
});
if (cronSecret) {
  await check("cron tick with secret", async () => {
    const r = await get("/api/internal/jobs/tick", { method: "POST", headers: { authorization: `Bearer ${cronSecret}` } });
    const body = await r.json().catch(() => ({}));
    expect(r.status === 200, `status ${r.status}`);
    return `runner ${body.data?.runner}, queued ${body.data?.queued}, failed (24h) ${body.data?.failedLastDay}`;
  });
}

for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${results.length} checks passed for ${base}.`);
process.exit(failed ? 1 : 0);
