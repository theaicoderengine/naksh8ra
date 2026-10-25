import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { withOrg, withSystem } from "@/server/db/tenant";
import { createSession } from "@/server/auth/session";
import { decrypt } from "@/server/auth/crypto";
import { aiJson, describeAi, estimateReservationTokens, sweepExpiredReservations, _test } from "@/server/ai/access";
import { PERSONAL_SUBJECT } from "@/server/ai/catalog";
import { JobDraftSchema } from "@/server/ai/prompts";
import { draftJobDescription, createJob } from "@/server/services/jobs";
import { getOrgAiSettings, removeOrgCredential, saveOrgCredential, setOrgAiRoutes, testOrgCredential, testNewKey } from "@/server/services/ai-settings";
import { getOrgAiAccess, setAiGrants } from "@/server/services/ai-admin";
import { saveTemplate, listCompetencies } from "@/server/services/templates";
import { addCandidateToJob } from "@/server/services/applications";
import { inviteToInterview, resolveInterviewAccess, recordConsent, startInterview, submitStructuredAnswer, completeInterview } from "@/server/services/interviews";
import { runAssessment } from "@/server/services/assessments";
import { startPractice } from "@/server/services/practice";
import { makeOrg, makeUser, sessionFor, addMember, meta, uid, grantPlatformAi } from "../helpers";
import * as settingsRoute from "@/app/api/v1/ai/settings/route";
import * as credRoute from "@/app/api/v1/ai/credentials/[provider]/route";
import * as grantsRoute from "@/app/api/v1/platform/organisations/[id]/ai/grants/route";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(h: Handler, o: { method?: string; token: string; org?: string; body?: unknown; params?: Record<string, string> }) {
  const headers: Record<string, string> = { host: "localhost:3000", origin: "http://localhost:3000", cookie: `atlas_session=${o.token}` };
  if (o.org) headers["x-atlas-org"] = o.org;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await h(new NextRequest("http://localhost:3000/api/v1/x", { method: o.method ?? "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }), { params: Promise.resolve(o.params ?? {}) });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as { data?: any; error?: { code: string; message: string } } };
}
const tokenFor = async (userId: string, mfaVerified = false) => (await createSession(userId, { ip: "127.0.0.1", userAgent: "vitest", mfaVerified })).token;

const draft = { title: "Data Analyst", seniority: "Junior" };
const jsonReq = { purpose: "jd.v1", system: "s", user: `Draft a job description.\n${"x"}`, schema: JobDraftSchema as never };
const logs = (orgId: string) => withSystem("test", (tx) => tx.aiRequestLog.findMany({ where: { organisationId: orgId }, orderBy: { createdAt: "asc" } }));
const FIXTURE_KEY = { apiKey: "fixture-ok", model: "fixture-llm-v1" };
const counter = async (subject: string) => (await withSystem("test", (tx) => tx.aiUsageCounter.findFirst({ where: { subject, capability: "JOB_DRAFTING" } }))) ?? { requests: 0, tokens: 0, tokensReserved: 0 };
const openReservations = (subject: string) => withSystem("test", (tx) => tx.aiUsageReservation.count({ where: { subject } }));

describe("Platform AI access is denied by default", () => {
  it("a new organisation cannot invoke, or indirectly reach, platform-funded AI", async () => {
    const { org, ctx } = await makeOrg();
    for (const cap of ["JOB_DRAFTING", "ASSESSMENT", "INTERVIEW_CONVERSATION", "QUESTION_GENERATION", "TRANSCRIPTION"] as const) {
      const d = await describeAi({ kind: "ORG", organisationId: org.id }, cap);
      expect(d.available).toBe(false);
      if (!d.available) expect(d.code).toBe("AI_ACCESS_DENIED");
    }
    await expect(draftJobDescription(ctx, draft)).rejects.toMatchObject({ code: "AI_ACCESS_DENIED" });
    const l = await logs(org.id);
    expect(l.at(-1)).toMatchObject({ status: "DENIED", capability: "JOB_DRAFTING", errorCode: "AI_ACCESS_DENIED", provider: null });
  });

  it("an organisation cannot grant itself platform AI, even with direct database access", async () => {
    const { org, ctx } = await makeOrg();
    await expect(
      withOrg(org.id, ctx.userId, (tx) => tx.platformAiGrant.create({ data: { subject: org.id, organisationId: org.id, provider: "FIXTURE", capability: "JOB_DRAFTING" } })),
    ).rejects.toThrow(/row-level security|violates/i);
    // Nor can it pick a platform route for a capability it was not granted.
    await expect(setOrgAiRoutes(ctx, { routes: [{ capability: "JOB_DRAFTING", source: "PLATFORM", provider: "FIXTURE" }] }, meta)).rejects.toMatchObject({ code: "AI_ACCESS_DENIED" });
  });

  it("personal (student) AI is denied until granted for personal accounts", async () => {
    await withSystem("test reset personal", (tx) => tx.platformAiGrant.updateMany({ where: { subject: PERSONAL_SUBJECT }, data: { enabled: false } }));
    const student = await makeUser();
    await expect(startPractice(student.id, { targetRole: "Analyst", focus: "GENERAL", mode: "STRUCTURED_AUDIO", questionCount: 2, language: "en", durationMinutes: 10 })).rejects.toMatchObject({ code: "AI_ACCESS_DENIED" });
    await grantPlatformAi(PERSONAL_SUBJECT, ["PRACTICE_COACHING", "RESUME_PARSING", "TRANSCRIPTION"]);
    expect((await describeAi({ kind: "PERSONAL", userId: student.id }, "PRACTICE_COACHING")).available).toBe(true);
  });
});

describe("Platform admin grants and revokes access", () => {
  it("grant enables exactly that capability; revocation stops the next operation; both are audited", async () => {
    const { org, ctx } = await makeOrg();
    const admin = await grantPlatformAi(org.id, ["JOB_DRAFTING"]);
    const out = await draftJobDescription(ctx, draft);
    expect(out.aiSource).toBe("PLATFORM");
    expect(out.providerMode).toBe("FIXTURE");
    // Other capabilities remain denied.
    expect((await describeAi({ kind: "ORG", organisationId: org.id }, "ASSESSMENT")).available).toBe(false);

    await setAiGrants(admin, org.id, { reason: "trial ended", grants: [{ provider: "FIXTURE", capability: "JOB_DRAFTING", enabled: false, allowedModels: [], monthlyRequestLimit: null, monthlyTokenLimit: null }] }, meta);
    await expect(draftJobDescription(ctx, draft)).rejects.toMatchObject({ code: "AI_ACCESS_DENIED" });

    const detail = await getOrgAiAccess(admin, org.id);
    const actions = detail.history.map((h) => h.action);
    expect(actions).toContain("platform.ai.access_granted");
    expect(actions).toContain("platform.ai.access_revoked");
    expect(detail.history.find((h) => h.action === "platform.ai.access_revoked")?.reason).toBe("trial ended");
    expect(detail.organisation).toMatchObject({ id: org.id, name: org.name });
  });

  it("only MFA-verified super-admins can change platform AI access (service and route)", async () => {
    const { org, owner } = await makeOrg();
    const input = { reason: "attempt", grants: [{ provider: "FIXTURE" as const, capability: "ASSESSMENT" as const, enabled: true, allowedModels: [], monthlyRequestLimit: null, monthlyTokenLimit: null }] };
    const billing = await makeUser({ platformRole: "BILLING_ADMIN" });
    await expect(setAiGrants(await sessionFor(billing.id, true), org.id, input, meta)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const superNoMfa = await makeUser({ platformRole: "SUPER_ADMIN" });
    await expect(setAiGrants(await sessionFor(superNoMfa.id, false), org.id, input, meta)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The organisation's own owner hitting the platform endpoint.
    const r = await call(grantsRoute.PUT as Handler, { method: "PUT", token: await tokenFor(owner.id), params: { id: org.id }, body: input });
    expect([401, 403, 404]).toContain(r.status);
    expect(await prisma.platformAiGrant.count({ where: { subject: org.id } })).toBe(0);
  });
});

describe("Organisation-owned keys (BYOK)", () => {
  it("work without any platform permission, and operations say which source they used", async () => {
    const { org, ctx } = await makeOrg();
    const saved = await saveOrgCredential(ctx, "FIXTURE", FIXTURE_KEY, meta);
    expect(saved.test.ok).toBe(true);
    expect(saved.credential).toMatchObject({ status: "ACTIVE", maskedKey: "••••e-ok", model: "fixture-llm-v1" });
    const out = await draftJobDescription(ctx, draft);
    expect(out.aiSource).toBe("ORGANISATION");
    const l = (await logs(org.id)).at(-1)!;
    expect(l).toMatchObject({ status: "SUCCEEDED", source: "ORGANISATION", provider: "FIXTURE", capability: "JOB_DRAFTING" });
    expect(await prisma.platformAiGrant.count({ where: { subject: org.id } })).toBe(0);
  });

  it("keys are tested before activation; a failing key is never stored", async () => {
    const { org, ctx } = await makeOrg();
    expect((await testNewKey(ctx, "FIXTURE", { apiKey: "fixture-bad", model: "fixture-llm-v1" })).ok).toBe(false);
    await expect(saveOrgCredential(ctx, "FIXTURE", { apiKey: "fixture-bad", model: "fixture-llm-v1" }, meta)).rejects.toThrow(/Connection test failed.*not saved/);
    expect(await withOrg(org.id, null, (tx) => tx.orgAiCredential.count())).toBe(0);
  });

  it("secrets are encrypted at rest and never returned; only masked metadata reaches the client", async () => {
    const { org, ctx, owner } = await makeOrg();
    await saveOrgCredential(ctx, "FIXTURE", FIXTURE_KEY, meta);
    const row = await withOrg(org.id, null, (tx) => tx.orgAiCredential.findFirstOrThrow());
    expect(row.encryptedKey).not.toContain("fixture-ok");
    expect(decrypt(row.encryptedKey)).toBe("fixture-ok");
    const settings = await getOrgAiSettings(ctx);
    const json = JSON.stringify(settings);
    expect(json).not.toContain("fixture-ok");
    expect(json).not.toContain(row.encryptedKey);
    const api = await call(settingsRoute.GET as Handler, { token: await tokenFor(owner.id), org: org.slug });
    expect(api.status).toBe(200);
    expect(api.text).not.toContain("fixture-ok");
    expect(api.text).not.toContain("encryptedKey");
  });

  it("only users with ai.manage can view or change AI provider settings", async () => {
    const { org } = await makeOrg();
    const rec = await addMember(org.id, "RECRUITER");
    await expect(saveOrgCredential(rec.ctx, "FIXTURE", FIXTURE_KEY, meta)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const tok = await tokenFor(rec.user.id);
    expect((await call(settingsRoute.GET as Handler, { token: tok, org: org.slug })).status).toBe(403);
    expect((await call(credRoute.PUT as Handler, { method: "PUT", token: tok, org: org.slug, params: { provider: "FIXTURE" }, body: FIXTURE_KEY })).status).toBe(403);
    const hr = await addMember(org.id, "HR_ADMIN");
    expect((await saveOrgCredential(hr.ctx, "FIXTURE", FIXTURE_KEY, meta)).test.ok).toBe(true);
  });

  it("remains usable when platform access is revoked", async () => {
    const { org, ctx } = await makeOrg();
    const admin = await grantPlatformAi(org.id, ["JOB_DRAFTING"]);
    await saveOrgCredential(ctx, "FIXTURE", FIXTURE_KEY, meta);
    await setAiGrants(admin, org.id, { reason: "revoke", grants: [{ provider: "FIXTURE", capability: "JOB_DRAFTING", enabled: false, allowedModels: [], monthlyRequestLimit: null, monthlyTokenLimit: null }] }, meta);
    expect((await draftJobDescription(ctx, draft)).aiSource).toBe("ORGANISATION");
  });
});

describe("No unauthorised fallback", () => {
  it("an explicitly selected org key that is removed fails clearly instead of using a granted platform key", async () => {
    const { org, ctx } = await makeOrg();
    await grantPlatformAi(org.id, ["JOB_DRAFTING"]);
    await saveOrgCredential(ctx, "FIXTURE", FIXTURE_KEY, meta);
    await setOrgAiRoutes(ctx, { routes: [{ capability: "JOB_DRAFTING", source: "ORGANISATION", provider: "FIXTURE" }] }, meta);
    const removed = await removeOrgCredential(ctx, "FIXTURE", meta);
    expect(removed.routesNeedingAttention).toBe(1);
    await expect(draftJobDescription(ctx, draft)).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    expect((await logs(org.id)).some((l) => l.source === "PLATFORM" && l.status === "SUCCEEDED")).toBe(false);
  });

  it("a quota error on the org key is reported — never retried on the platform key or another model", async () => {
    const { org, ctx } = await makeOrg();
    await grantPlatformAi(org.id, ["JOB_DRAFTING"]);
    await saveOrgCredential(ctx, "FIXTURE", FIXTURE_KEY, meta);
    // Simulate the key hitting its quota (rotate to the fixture "quota" key directly in storage).
    const { encrypt } = await import("@/server/auth/crypto");
    await withOrg(org.id, null, (tx) => tx.orgAiCredential.updateMany({ data: { encryptedKey: encrypt("fixture-quota") } }));
    await expect(draftJobDescription(ctx, draft)).rejects.toMatchObject({ code: "PROVIDER_QUOTA_EXCEEDED" });
    const after = await logs(org.id);
    const last = after.at(-1)!;
    expect(last).toMatchObject({ status: "FAILED", source: "ORGANISATION", errorCode: "quota" });
    expect(after.filter((l) => l.source === "PLATFORM")).toHaveLength(0);
    // Quota is not an auth failure: the key stays active, with the error recorded for the admin.
    const cred = await withOrg(org.id, null, (tx) => tx.orgAiCredential.findFirstOrThrow());
    expect(cred.status).toBe("ACTIVE");
    expect(cred.lastError).toMatch(/quota/i);
  });

  it("an org key rejected at use time is marked invalid and is not silently replaced", async () => {
    const { org, ctx } = await makeOrg();
    await grantPlatformAi(org.id, ["JOB_DRAFTING"]);
    await saveOrgCredential(ctx, "FIXTURE", FIXTURE_KEY, meta);
    await setOrgAiRoutes(ctx, { routes: [{ capability: "JOB_DRAFTING", source: "ORGANISATION", provider: "FIXTURE" }] }, meta);
    const { encrypt } = await import("@/server/auth/crypto");
    await withOrg(org.id, null, (tx) => tx.orgAiCredential.updateMany({ data: { encryptedKey: encrypt("fixture-bad") } }));
    await expect(draftJobDescription(ctx, draft)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    const t = await testOrgCredential(ctx, "FIXTURE");
    expect(t.test.ok).toBe(false);
    expect(t.credential.status).toBe("INVALID");
    await expect(draftJobDescription(ctx, draft)).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });
});

describe("Tenant isolation of keys, logs and settings", () => {
  it("tenant A's key is never used for, or visible to, tenant B", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await saveOrgCredential(a.ctx, "FIXTURE", FIXTURE_KEY, meta);
    const aCred = await withOrg(a.org.id, null, (tx) => tx.orgAiCredential.findFirstOrThrow());
    // B has no key and no grant: denied, even though a working key exists on the platform for A.
    await expect(draftJobDescription(b.ctx, draft)).rejects.toMatchObject({ code: "AI_ACCESS_DENIED" });
    await draftJobDescription(a.ctx, draft);
    // RLS: B's context cannot see A's credential or A's request log.
    expect(await withOrg(b.org.id, null, (tx) => tx.orgAiCredential.findMany())).toHaveLength(0);
    expect(await withOrg(b.org.id, null, (tx) => tx.aiRequestLog.findMany({ where: { organisationId: a.org.id } }))).toHaveLength(0);
    expect(await withOrg(b.org.id, null, (tx) => tx.orgAiCredential.updateMany({ where: { id: aCred.id }, data: { model: "x" } }))).toMatchObject({ count: 0 });
    const bSettings = JSON.stringify(await getOrgAiSettings(b.ctx));
    expect(bSettings).not.toContain(aCred.keyFingerprint);
    // Every log row that used A's credential belongs to A.
    const used = await withSystem("test", (tx) => tx.aiRequestLog.findMany({ where: { credentialId: aCred.id } }));
    expect(used.length).toBeGreaterThan(0);
    expect(used.every((l) => l.organisationId === a.org.id)).toBe(true);
  });

  it("a forged organisation header cannot read another tenant's AI settings", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await saveOrgCredential(a.ctx, "FIXTURE", FIXTURE_KEY, meta);
    const r = await call(settingsRoute.GET as Handler, { token: await tokenFor(b.owner.id), org: a.org.slug });
    expect([403, 404]).toContain(r.status);
  });
});

describe("Model restrictions", () => {
  const saved = process.env.AI_MODEL_CATALOG_JSON;
  beforeAll(() => {
    process.env.AI_MODEL_CATALOG_JSON = JSON.stringify([{ provider: "FIXTURE", id: "fixture-llm-v2" }]);
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AI_MODEL_CATALOG_JSON;
    else process.env.AI_MODEL_CATALOG_JSON = saved;
  });

  it("unsupported models are rejected for keys, grants and routes", async () => {
    const { org, ctx } = await makeOrg();
    await expect(saveOrgCredential(ctx, "FIXTURE", { apiKey: "fixture-ok", model: "gpt-imaginary-9" }, meta)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(saveOrgCredential(ctx, "GEMINI", { apiKey: "AIza-whatever-123456", model: "not-a-gemini-model" }, meta)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(grantPlatformAi(org.id, ["ASSESSMENT"], { allowedModels: ["made-up-model"] })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(grantPlatformAi(org.id, ["TRANSCRIPTION"], { provider: "GEMINI" })).rejects.toThrow(/does not provide/);
  });

  it("platform model allow-lists are enforced on every operation", async () => {
    const { org, ctx } = await makeOrg();
    await grantPlatformAi(org.id, ["JOB_DRAFTING"], { allowedModels: ["fixture-llm-v1"] });
    await expect(setOrgAiRoutes(ctx, { routes: [{ capability: "JOB_DRAFTING", source: "PLATFORM", provider: "FIXTURE", model: "fixture-llm-v2" }] }, meta)).rejects.toMatchObject({ code: "AI_ACCESS_DENIED" });
    await setOrgAiRoutes(ctx, { routes: [{ capability: "JOB_DRAFTING", source: "PLATFORM", provider: "FIXTURE", model: "fixture-llm-v1" }] }, meta);
    expect((await draftJobDescription(ctx, draft)).model).toBe("fixture-llm-v1");
    // The admin narrows the allow-list after the org picked a model: the next call is refused.
    await grantPlatformAi(org.id, ["JOB_DRAFTING"], { allowedModels: ["fixture-llm-v2"] });
    await expect(draftJobDescription(ctx, draft)).rejects.toMatchObject({ code: "AI_ACCESS_DENIED" });
  });

  it("a model removed from the supported list stops an org key from being used", async () => {
    const { ctx } = await makeOrg();
    await saveOrgCredential(ctx, "FIXTURE", { apiKey: "fixture-ok", model: "fixture-llm-v1" }, meta);
    const before = process.env.AI_MODEL_CATALOG_JSON;
    process.env.AI_MODEL_CATALOG_JSON = JSON.stringify([{ provider: "FIXTURE", id: "fixture-llm-v1", remove: true }]);
    try {
      await expect(draftJobDescription(ctx, draft)).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    } finally {
      process.env.AI_MODEL_CATALOG_JSON = before;
    }
  });
});

describe("Concurrency, limits and credential rotation", () => {
  it("concurrent requests cannot exceed the platform monthly request limit", async () => {
    const { org } = await makeOrg();
    await grantPlatformAi(org.id, ["JOB_DRAFTING"], { monthlyRequestLimit: 3 });
    const scope = { kind: "ORG" as const, organisationId: org.id };
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => aiJson(scope, "JOB_DRAFTING", jsonReq)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(5);
    expect(rejected.every((r) => r.reason.code === "AI_LIMIT_REACHED")).toBe(true);
    const counter = await withSystem("test", (tx) => tx.aiUsageCounter.findFirstOrThrow({ where: { subject: org.id, capability: "JOB_DRAFTING" } }));
    expect(counter.requests).toBe(3);
    expect(counter.tokens).toBeGreaterThan(0);
  });

  it("concurrent reservations cannot exceed the token limit (worst case reserved atomically)", async () => {
    const { org } = await makeOrg();
    const E = estimateReservationTokens("FIXTURE", "json", jsonReq);
    const limit = 3 * E + Math.floor(E / 2);
    await grantPlatformAi(org.id, ["JOB_DRAFTING"], { monthlyTokenLimit: limit });
    const scope = { kind: "ORG" as const, organisationId: org.id };
    // 8 attempts in flight at once (none settled): exactly 3 fit.
    const held = await Promise.allSettled(Array.from({ length: 8 }, () => _test.reservePlatform(scope, { provider: "FIXTURE", capability: "JOB_DRAFTING", model: "fixture-llm-v1" }, E)));
    const ok = held.filter((r): r is PromiseFulfilledResult<{ id: string; tokens: number }> => r.status === "fulfilled");
    expect(ok).toHaveLength(3);
    expect(held.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.code === "AI_LIMIT_REACHED")).toBe(true);
    expect(await counter(org.id)).toMatchObject({ requests: 3, tokensReserved: 3 * E, tokens: 0 });
    // Settling releases the unused part of each reservation.
    for (const r of ok) await _test.settleReservation(r.value, 150);
    expect(await counter(org.id)).toMatchObject({ tokensReserved: 0, tokens: 450 });
  });

  it("end to end under concurrency, settled + reserved usage never exceeds the limit", async () => {
    const { org } = await makeOrg();
    const E = estimateReservationTokens("FIXTURE", "json", jsonReq);
    const limit = 2 * E;
    await grantPlatformAi(org.id, ["JOB_DRAFTING"], { monthlyTokenLimit: limit });
    const scope = { kind: "ORG" as const, organisationId: org.id };
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => aiJson(scope, "JOB_DRAFTING", jsonReq)));
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(2);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.code === "AI_LIMIT_REACHED")).toBe(true);
    const c = await counter(org.id);
    expect(c.tokensReserved).toBe(0);
    expect(c.tokens).toBe(150 * succeeded);
    expect(c.tokens + E).toBeGreaterThan(limit - E); // sanity: limit was actually binding
    expect(c.tokens).toBeLessThanOrEqual(limit);
    expect(await openReservations(org.id)).toBe(0);
  });

  it("reservations are reconciled after failures: transient errors retry with a fresh reservation each; quota errors do not retry", async () => {
    const { org } = await makeOrg();
    await grantPlatformAi(org.id, ["JOB_DRAFTING"]);
    const scope = { kind: "ORG" as const, organisationId: org.id };
    const req = (marker: string) => ({ ...jsonReq, user: `${jsonReq.user} ${marker}` });
    const inputEst = (marker: string) => estimateReservationTokens("FIXTURE", "json", req(marker)) - estimateReservationTokens("FIXTURE", "json", { system: "", user: "" });

    // 503 / unavailable: 1 + AI_MAX_RETRIES attempts, each reserved and settled; input estimate charged per attempt.
    await expect(aiJson(scope, "JOB_DRAFTING", req("[[fixture:unavailable]]"))).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    let c = await counter(org.id);
    expect(c.requests).toBe(3);
    expect(c.tokensReserved).toBe(0);
    expect(c.tokens).toBe(3 * inputEst("[[fixture:unavailable]]"));
    const attempts = (await logs(org.id)).filter((l) => l.errorCode === "unavailable").map((l) => l.attempt);
    expect(attempts).toEqual([1, 2, 3]);

    // Timeout: retried as well, input estimate charged.
    await expect(aiJson(scope, "JOB_DRAFTING", req("[[fixture:timeout]]"))).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    c = await counter(org.id);
    expect(c.requests).toBe(6);
    expect(c.tokens).toBe(3 * inputEst("[[fixture:unavailable]]") + 3 * inputEst("[[fixture:timeout]]"));

    // Quota (429): one attempt, nothing charged, no retry.
    const before = await counter(org.id);
    await expect(aiJson(scope, "JOB_DRAFTING", req("[[fixture:quota]]"))).rejects.toMatchObject({ code: "PROVIDER_QUOTA_EXCEEDED" });
    c = await counter(org.id);
    expect(c.requests).toBe(before.requests + 1);
    expect(c.tokens).toBe(before.tokens);

    // A failure that reports usage is charged exactly that usage.
    await expect(aiJson(scope, "JOB_DRAFTING", req("[[fixture:usage-then-fail]]"))).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect((await counter(org.id)).tokens).toBe(c.tokens + 100);
    expect(await openReservations(org.id)).toBe(0);
  });

  it("a retry stops immediately when access is revoked between attempts", async () => {
    const { org } = await makeOrg();
    const admin = await grantPlatformAi(org.id, ["JOB_DRAFTING"]);
    const scope = { kind: "ORG" as const, organisationId: org.id };
    const p = aiJson(scope, "JOB_DRAFTING", { ...jsonReq, user: `${jsonReq.user} [[fixture:unavailable]]` });
    await setAiGrants(admin, org.id, { reason: "revoke mid-retry", grants: [{ provider: "FIXTURE", capability: "JOB_DRAFTING", enabled: false, allowedModels: [], monthlyRequestLimit: null, monthlyTokenLimit: null }] }, meta);
    await expect(p).rejects.toMatchObject({ code: expect.stringMatching(/AI_ACCESS_DENIED|PROVIDER_ERROR/) });
    const l = await logs(org.id);
    expect(l.filter((x) => x.status === "FAILED").length).toBeLessThan(3); // did not complete all retries after revocation
    expect(await openReservations(org.id)).toBe(0);
  });

  it("orphaned reservations (crashed process) are swept and charged conservatively; a late settle corrects them", async () => {
    const { org } = await makeOrg();
    await grantPlatformAi(org.id, ["JOB_DRAFTING"], { monthlyTokenLimit: 1_000_000 });
    const scope = { kind: "ORG" as const, organisationId: org.id };
    const res = await _test.reservePlatform(scope, { provider: "FIXTURE", capability: "JOB_DRAFTING", model: "fixture-llm-v1" }, 5000);
    expect(await counter(org.id)).toMatchObject({ requests: 1, tokensReserved: 5000, tokens: 0 });
    // Not yet expired: the sweep leaves it alone.
    expect((await sweepExpiredReservations()).expired).toBe(0);
    // Simulate time passing beyond expiry.
    expect((await sweepExpiredReservations(new Date(Date.now() + 86400_000))).expired).toBeGreaterThanOrEqual(1);
    expect(await counter(org.id)).toMatchObject({ tokensReserved: 0, tokens: 5000 });
    await _test.settleReservation(res, 120); // the process recovered and reports actual usage
    expect(await counter(org.id)).toMatchObject({ tokensReserved: 0, tokens: 120 });
    await _test.settleReservation(res, 120); // idempotent
    expect((await counter(org.id)).tokens).toBe(120);
  });

  it("a request larger than the remaining token budget is refused before calling the provider", async () => {
    const { org } = await makeOrg();
    await grantPlatformAi(org.id, ["JOB_DRAFTING"], { monthlyTokenLimit: 100 });
    const scope = { kind: "ORG" as const, organisationId: org.id };
    await expect(aiJson(scope, "JOB_DRAFTING", jsonReq)).rejects.toMatchObject({ code: "AI_LIMIT_REACHED" });
    expect(await counter(org.id)).toMatchObject({ requests: 0, tokens: 0, tokensReserved: 0 });
    expect((await logs(org.id)).filter((l) => l.status === "SUCCEEDED")).toHaveLength(0);
  });

  it("rotation takes effect for the next operation; concurrent operations use a consistent credential version", async () => {
    const { org, ctx } = await makeOrg();
    await saveOrgCredential(ctx, "FIXTURE", FIXTURE_KEY, meta);
    const scope = { kind: "ORG" as const, organisationId: org.id };
    await aiJson(scope, "JOB_DRAFTING", jsonReq);
    const [, , rotated] = await Promise.all([aiJson(scope, "JOB_DRAFTING", jsonReq), aiJson(scope, "JOB_DRAFTING", jsonReq), saveOrgCredential(ctx, "FIXTURE", FIXTURE_KEY, meta), aiJson(scope, "JOB_DRAFTING", jsonReq)]);
    expect(rotated.credential.version).toBe(2);
    await aiJson(scope, "JOB_DRAFTING", jsonReq);
    const l = (await logs(org.id)).filter((x) => x.status === "SUCCEEDED");
    expect(l[0].credentialVersion).toBe(1);
    expect(l.at(-1)!.credentialVersion).toBe(2);
    expect(l.every((x) => x.credentialVersion === 1 || x.credentialVersion === 2)).toBe(true);
  });
});

describe("Background workers re-resolve access with the job's own tenant", () => {
  async function completedInterview(org: Awaited<ReturnType<typeof makeOrg>>) {
    process.env.EXPOSE_TEST_TOKENS = "true";
    const comps = await listCompetencies(org.ctx);
    const t = await saveTemplate(org.ctx, null, { name: `AI ${uid()}`, mode: "STRUCTURED_AUDIO", language: "en", durationMinutes: 10, questionCount: 1, difficulty: "INTERMEDIATE", questionSelection: "FIXED", maxFollowUps: 0, answerSeconds: 60, prepSeconds: 0, retakesAllowed: 0, recordAudio: false, storeTranscript: true, showTranscriptToCandidate: false, allowResume: true, accessibilityOptions: { allowTypedAnswers: true, extendedTimeMultiplier: 1, captions: true }, competencyIds: [comps[0].id], questions: [{ prompt: "Tell me about a project.", competencyId: comps[0].id }] }, meta);
    const j = await createJob(org.ctx, { title: `Job ${uid()}`, description: "A suitably long description for the vacancy.", requiredQualifications: [], requiredSkills: [], preferredSkills: [], remotePolicy: "REMOTE", employmentType: "FULL_TIME", openings: 1, visibility: "PUBLIC", campusHiring: false, eligibleGraduationYears: [], eligibleDegrees: [], eligibleProgrammeIds: [], screeningQuestions: [], aiDraftUsed: false } as never, meta);
    const app = await addCandidateToJob(org.ctx, { jobId: j.id, email: `c-${uid()}@x.test`, firstName: "C", lastName: "D", source: "DIRECT" }, meta);
    const inv = (await inviteToInterview(org.ctx, app.id, { templateId: t.id, expiresInDays: 7 }, meta)) as { testToken: string; sessionId: string };
    const access = await resolveInterviewAccess({ token: inv.testToken }, null);
    await recordConsent(access, { recording: false, aiAssessment: true, transcript: true }, meta);
    await startInterview(access, meta);
    await submitStructuredAnswer(access, { position: 0, text: "I led the migration of our reporting pipeline and halved failed runs over a quarter." });
    await completeInterview(access); // inline queue runs the assessment job now
    return inv.sessionId;
  }

  it("revocation before a queued assessment starts stops it; the job never borrows another tenant's access", async () => {
    const a = await makeOrg({ credits: 2 });
    const b = await makeOrg();
    await grantPlatformAi(b.org.id, ["ASSESSMENT"]); // B is authorised; A is not
    const sessionId = await completedInterview(a);
    const first = await withOrg(a.org.id, null, (tx) => tx.interviewSession.findFirstOrThrow({ where: { id: sessionId }, include: { assessment: true } }));
    expect(first.status).toBe("FAILED"); // assessment refused: A has no AI access
    expect(first.assessment?.failureReason).toMatch(/not available/);
    // A forged job payload naming tenant B does nothing: the session is not B's.
    await runAssessment(b.org.id, sessionId);
    expect(await logs(b.org.id)).toHaveLength(0);
    let s = await withOrg(a.org.id, null, (tx) => tx.interviewSession.findFirstOrThrow({ where: { id: sessionId } }));
    expect(s.status).toBe("FAILED");
    // After A is granted access, a retry succeeds — and is logged against A.
    await grantPlatformAi(a.org.id, ["ASSESSMENT"]);
    await runAssessment(a.org.id, sessionId);
    s = await withOrg(a.org.id, null, (tx) => tx.interviewSession.findFirstOrThrow({ where: { id: sessionId } }));
    expect(["ASSESSED", "REQUIRES_REVIEW"]).toContain(s.status);
    expect((await logs(a.org.id)).some((l) => l.capability === "ASSESSMENT" && l.status === "SUCCEEDED" && l.sessionId === sessionId)).toBe(true);
    // The interview credit was consumed once at completion; a failed assessment did not create extra charges.
    const ledger = await withOrg(a.org.id, null, (tx) => tx.creditLedgerEntry.findMany({ where: { organisationId: a.org.id, type: "CONSUME" } }));
    expect(ledger).toHaveLength(1);
  });
});

describe("Security review regressions", () => {
  it("an undecryptable stored key (e.g. ENCRYPTION_KEY changed) fails clearly and never falls back to platform AI", async () => {
    const { org, ctx } = await makeOrg();
    await grantPlatformAi(org.id, ["JOB_DRAFTING"]);
    await saveOrgCredential(ctx, "FIXTURE", FIXTURE_KEY, meta);
    await withOrg(org.id, null, (tx) => tx.orgAiCredential.updateMany({ data: { encryptedKey: "v1:not-a-valid-ciphertext" } }));
    await expect(draftJobDescription(ctx, draft)).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED", details: { reason: "undecryptable" } });
    expect((await logs(org.id)).some((l) => l.source === "PLATFORM")).toBe(false);
  });

  it("candidate-facing AI errors are neutral: no provider, quota tier or configuration details", async () => {
    const { candidateSafe } = await import("@/server/http/interview-access");
    const { AppError } = await import("@/server/errors");
    const err = await candidateSafe(Promise.reject(new AppError("PROVIDER_QUOTA_EXCEEDED", "Gemini quota or rate limit reached. Free-tier quotas are lower…"))).catch((e) => e);
    expect(err.code).toBe("PROVIDER_QUOTA_EXCEEDED");
    expect(err.message).not.toMatch(/Gemini|Free-tier|key|Settings|platform/i);
    const other = await candidateSafe(Promise.reject(new AppError("INVALID_STATE", "The interview is not in progress"))).catch((e) => e);
    expect(other.message).toBe("The interview is not in progress"); // non-AI errors unchanged
  });

  it("the app refuses to start with un-overridable AI SDK environment variables", async () => {
    const { env, resetEnvCache } = await import("@/server/env");
    process.env.ANTHROPIC_CUSTOM_HEADERS = "x-leak: 1";
    resetEnvCache();
    try {
      expect(() => env()).toThrow(/Unsupported AI SDK environment variables/);
    } finally {
      delete process.env.ANTHROPIC_CUSTOM_HEADERS;
      resetEnvCache();
    }
    expect(() => env()).not.toThrow();
  });

  it("request logs: organisations can read but never alter them; system jobs can prune and pseudonymise", async () => {
    const { org, ctx } = await makeOrg();
    await saveOrgCredential(ctx, "FIXTURE", FIXTURE_KEY, meta);
    await draftJobDescription(ctx, draft);
    expect((await withOrg(org.id, null, (tx) => tx.aiRequestLog.updateMany({ data: { status: "FAILED" } }))).count).toBe(0);
    expect((await withOrg(org.id, null, (tx) => tx.aiRequestLog.deleteMany({}))).count).toBe(0);
    expect((await withSystem("test", (tx) => tx.aiRequestLog.updateMany({ where: { organisationId: org.id }, data: { userId: null } }))).count).toBeGreaterThan(0);
  });

  it("platform staff viewing an organisation's AI access is audited", async () => {
    const { org } = await makeOrg();
    const admin = await makeUser({ platformRole: "SUPER_ADMIN" });
    await getOrgAiAccess(await sessionFor(admin.id, true), org.id, meta);
    expect(await prisma.auditEvent.count({ where: { organisationId: org.id, action: "platform.ai_access_viewed", actorUserId: admin.id } })).toBe(1);
  });
});
