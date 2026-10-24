/**
 * Local performance / load measurement.
 *
 *   npm run perf                       (server must already be running)
 *
 * Env:
 *   PERF_BASE_URL       default http://localhost:3000
 *   PERF_CONCURRENCY    concurrent clients for the API phase (default 20)
 *   PERF_REQUESTS       requests per endpoint in the API phase (default 300)
 *   PERF_INTERVIEWS     concurrent candidate interviews (default 20)
 *   PERF_ORG_SLUG       default northwind-labs (demo seed)
 *   PERF_EMAIL / PERF_PASSWORD  HR user (default demo hr@northwind.example)
 *
 * Requirements: a NON-PRODUCTION server with the demo seed, EXPOSE_TEST_TOKENS=true
 * (so invitation tokens are returned to the script instead of only by email) and
 * RATE_LIMIT_MULTIPLIER raised (e.g. 50) so rate limits do not dominate the result.
 * Credits for the interview phase are granted directly in the database
 * (ledger entry type ADJUSTMENT, reason "perf test").
 *
 * What this measures honestly: application + database latency with whatever
 * providers the server is configured with. With fixture AI/STT providers the
 * interview numbers EXCLUDE real model/transcription latency, which in production
 * dominates turn time; re-run against staging with real providers for that.
 */
import { withSystem } from "../../src/server/db/tenant";
import { grant } from "../../src/server/billing/credits";
import { prisma } from "../../src/server/db/client";

const BASE = process.env.PERF_BASE_URL ?? "http://localhost:3000";
const CONC = Number(process.env.PERF_CONCURRENCY ?? 20);
const REQS = Number(process.env.PERF_REQUESTS ?? 300);
const INTERVIEWS = Number(process.env.PERF_INTERVIEWS ?? 20);
const ORG = process.env.PERF_ORG_SLUG ?? "northwind-labs";
const EMAIL = process.env.PERF_EMAIL ?? "hr@northwind.example";
const PASSWORD = process.env.PERF_PASSWORD || process.env.SEED_DEMO_PASSWORD || "Demo-password-2026!";

type Stat = { name: string; samples: number[]; errors: number; statuses: Record<string, number> };
const stats = new Map<string, Stat>();
function record(name: string, ms: number, ok: boolean, status: number | string) {
  let s = stats.get(name);
  if (!s) stats.set(name, (s = { name, samples: [], errors: 0, statuses: {} }));
  s.samples.push(ms);
  if (!ok) s.errors++;
  s.statuses[String(status)] = (s.statuses[String(status)] ?? 0) + 1;
}
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];
};

async function call(name: string, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const t0 = performance.now();
  let status: number | string = "ERR";
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { origin: BASE, accept: "application/json", ...(init.headers ?? {}) } });
    status = res.status;
    const text = await res.text();
    const ms = performance.now() - t0;
    record(name, ms, res.ok, status);
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    return { res, json: json as { data?: any; error?: { message?: string } } | null };
  } catch (e) {
    record(name, performance.now() - t0, false, status);
    throw e;
  }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<unknown>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const x = items[i++];
        await fn(x).catch(() => undefined);
      }
    }),
  );
}

async function login() {
  const { res, json } = await call("auth.login", "/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${json?.error?.message}. Is the demo seed loaded?`);
  const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).join("; ");
  return cookie;
}

async function apiPhase(cookie: string) {
  const auth = { cookie, "x-atlas-org": ORG };
  const endpoints: [string, string, Record<string, string>][] = [
    ["GET /api/health", "/api/health", {}],
    ["GET /api/ready", "/api/ready", {}],
    ["GET /opportunities (public)", "/api/v1/opportunities", {}],
    ["GET /auth/me", "/api/v1/auth/me", { cookie }],
    ["GET /jobs", "/api/v1/jobs", auth],
    ["GET /applications", "/api/v1/applications", auth],
    ["GET /analytics/dashboard", "/api/v1/analytics/dashboard", auth],
  ];
  for (const [name, path, headers] of endpoints) {
    const t0 = performance.now();
    await pool(Array.from({ length: REQS }), CONC, () => call(name, path, { headers }));
    const s = stats.get(name)!;
    (s as Stat & { rps?: number }).rps = REQS / ((performance.now() - t0) / 1000);
  }
}

async function interviewPhase(cookie: string) {
  const auth = { cookie, "x-atlas-org": ORG, "content-type": "application/json" };
  const org = await withSystem("perf: lookup", (tx) => tx.organisation.findUniqueOrThrow({ where: { slug: ORG }, select: { id: true } }));
  await withSystem("perf: grant credits", (tx) => grant(tx, { organisationId: org.id }, INTERVIEWS, "ADJUSTMENT", `perf:${Date.now()}`, { reason: "perf test" }));

  const jobs = await call("GET /jobs", "/api/v1/jobs?status=PUBLISHED", { headers: auth });
  const job = (jobs.json?.data?.items ?? jobs.json?.data ?? [])[0];
  const tpls = await call("GET /interview-templates", "/api/v1/interview-templates", { headers: auth });
  const tpl = ((tpls.json?.data?.items ?? tpls.json?.data ?? []) as { id: string; mode: string; archivedAt?: string | null }[]).find((t) => t.mode === "STRUCTURED_AUDIO" && !t.archivedAt);
  if (!job || !tpl) throw new Error("Need a published job and a structured-audio template (demo seed provides both)");

  // Setup (sequential-ish, not part of the concurrency measurement).
  const tokens: string[] = [];
  const run = Date.now().toString(36);
  await pool(Array.from({ length: INTERVIEWS }, (_, i) => i), 5, async (i) => {
    const c = await call("setup POST /candidates", "/api/v1/candidates", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ jobId: job.id, email: `perf-${run}-${i}@perf.test`, firstName: "Perf", lastName: `Candidate${i}`, source: "DIRECT" }),
    });
    if (!c.res.ok) throw new Error(`candidate: ${c.json?.error?.message}`);
    const inv = await call("setup POST /applications/{id}/interviews", `/api/v1/applications/${c.json!.data.id}/interviews`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ templateId: tpl.id, expiresInDays: 7 }),
    });
    if (!inv.res.ok) throw new Error(`invite: ${inv.json?.error?.message}`);
    if (!inv.json?.data?.testToken) throw new Error("Server did not return testToken — set EXPOSE_TEST_TOKENS=true on a non-production server");
    tokens.push(inv.json.data.testToken);
  });
  if (tokens.length < INTERVIEWS) console.warn(`Only ${tokens.length}/${INTERVIEWS} invitations created; see setup errors below.`);

  // A minimal WebM (EBML header) so file sniffing accepts it; fixture STT returns a canned transcript.
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(4000).fill(1)]);
  const t0 = performance.now();
  let completed = 0;
  await Promise.all(
    tokens.map(async (token) => {
      const h = { "x-interview-token": token };
      const tStart = performance.now();
      await call("interview GET state", "/api/v1/interview-session/state", { headers: h });
      await call("interview POST consent", "/api/v1/interview-session/consent", {
        method: "POST",
        headers: { ...h, "content-type": "application/json" },
        body: JSON.stringify({ recording: true, aiAssessment: true, transcript: true }),
      });
      const st = await call("interview POST start", "/api/v1/interview-session/start", { method: "POST", headers: h });
      let position: number | undefined = st.json?.data?.question?.position;
      let done = position === undefined;
      let n = 0;
      while (!done && n < 20) {
        const fd = new FormData();
        fd.set("position", String(position));
        fd.set("idempotencyKey", `${token.slice(0, 8)}-${position}`);
        let name = "interview POST answer (typed)";
        if (n === 0) {
          fd.set("file", new Blob([webm], { type: "audio/webm" }), "answer.webm");
          fd.set("durationMs", "8000");
          name = "interview POST answer (audio → STT)";
        } else {
          fd.set("text", "I led the migration of our reporting pipeline, wrote tests for each transformation and reduced failed runs by half over a quarter.");
        }
        const a = await call(name, "/api/v1/interview-session/answer", { method: "POST", headers: h, body: fd });
        if (!a.res.ok) break;
        done = !!a.json?.data?.done;
        position = a.json?.data?.next?.position ?? a.json?.data?.question?.position ?? (position ?? 0) + 1;
        n++;
      }
      const c = await call("interview POST complete (+assessment)", "/api/v1/interview-session/complete", { method: "POST", headers: h });
      if (c.res.ok) completed++;
      record("interview end-to-end", performance.now() - tStart, c.res.ok, c.res.status);
    }),
  );
  return { total: tokens.length, completed, wallMs: performance.now() - t0, providerNote: "server-configured providers" };
}

function report(extra: Record<string, unknown>) {
  const rows = [...stats.values()].map((s) => ({
    endpoint: s.name,
    n: s.samples.length,
    errors: s.errors,
    p50_ms: Math.round(pct(s.samples, 50)),
    p95_ms: Math.round(pct(s.samples, 95)),
    p99_ms: Math.round(pct(s.samples, 99)),
    max_ms: Math.round(Math.max(...s.samples)),
    rps: (s as Stat & { rps?: number }).rps ? Math.round((s as Stat & { rps?: number }).rps!) : "",
    statuses: Object.entries(s.statuses).map(([k, v]) => `${k}×${v}`).join(" "),
  }));
  console.table(rows);
  console.log(JSON.stringify({ base: BASE, concurrency: CONC, requestsPerEndpoint: REQS, interviews: INTERVIEWS, ...extra }, null, 2));
}

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Server not reachable at ${BASE}`);
  const cookie = await login();
  await apiPhase(cookie);
  const iv = INTERVIEWS > 0 ? await interviewPhase(cookie) : null;
  report({ interviewPhase: iv });
  await prisma.$disconnect();
  const errs = [...stats.values()].filter((s) => !s.name.startsWith("setup")).reduce((a, s) => a + s.errors, 0);
  if (errs) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  report({});
  await prisma.$disconnect();
  process.exit(1);
});
