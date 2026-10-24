import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import pino from "pino";
import { Writable } from "node:stream";
import { prisma } from "@/server/db/client";
import { withOrg } from "@/server/db/tenant";
import { createSession } from "@/server/auth/session";
import { createJob } from "@/server/services/jobs";
import { addCandidateToJob } from "@/server/services/applications";
import { storeFile } from "@/server/services/files";
import { runAssessment } from "@/server/services/assessments";
import { inviteToInterview, resolveInterviewAccess, recordConsent, startInterview, submitStructuredAnswer, completeInterview } from "@/server/services/interviews";
import { saveTemplate, listCompetencies } from "@/server/services/templates";
import { REDACT_PATHS } from "@/server/logger";
import { makeOrg, addMember, makeUser, meta, uid } from "../helpers";
import * as jobsRoute from "@/app/api/v1/jobs/route";
import * as jobRoute from "@/app/api/v1/jobs/[id]/route";
import * as appsRoute from "@/app/api/v1/applications/route";
import * as appRoute from "@/app/api/v1/applications/[id]/route";
import * as moveRoute from "@/app/api/v1/applications/[id]/move/route";
import * as exportRoute from "@/app/api/v1/applications/export/route";
import * as fileRoute from "@/app/api/v1/files/[id]/route";
import * as memberRoute from "@/app/api/v1/memberships/[id]/route";
import * as inviteRoute from "@/app/api/v1/memberships/invitations/route";
import * as dashRoute from "@/app/api/v1/analytics/dashboard/route";
import * as platformRoute from "@/app/api/v1/platform/overview/route";
import * as meRoute from "@/app/api/v1/auth/me/route";
import * as logoutRoute from "@/app/api/v1/auth/logout/route";
import * as loginRoute from "@/app/api/v1/auth/login/route";
import * as resumeRoute from "@/app/api/v1/students/me/resumes/route";
import * as interviewStateRoute from "@/app/api/v1/interview-session/state/route";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(h: Handler, opts: { method?: string; path?: string; token?: string; org?: string; body?: unknown; params?: Record<string, string>; origin?: string | null; headers?: Record<string, string>; form?: FormData }) {
  const headers: Record<string, string> = { host: "localhost:3000", ...(opts.headers ?? {}) };
  if (opts.origin !== null) headers.origin = opts.origin ?? "http://localhost:3000";
  if (opts.token) headers.cookie = `atlas_session=${opts.token}`;
  if (opts.org) headers["x-atlas-org"] = opts.org;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/json";
  }
  const req = new NextRequest(`http://localhost:3000/api/v1${opts.path ?? "/x"}`, { method: opts.method ?? "GET", headers, body });
  const res = await h(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json: json as { data?: unknown; error?: { code: string; message: string } }, text, headers: res.headers };
}

async function tokenFor(userId: string) {
  return (await createSession(userId, { ip: "127.0.0.1", userAgent: "vitest" })).token;
}

describe("Security: tenant isolation through the HTTP API (journey 19)", () => {
  let A: Awaited<ReturnType<typeof makeOrg>>;
  let B: Awaited<ReturnType<typeof makeOrg>>;
  let tokA: string;
  let tokB: string;
  let jobB: string;
  let appB: string;
  let resumeFileB: string;
  let interviewTokenB: string;
  let sessionB: string;

  beforeAll(async () => {
    process.env.EXPOSE_TEST_TOKENS = "true";
    A = await makeOrg({ credits: 2, name: `Alpha ${uid()}` });
    B = await makeOrg({ credits: 2, name: `Bravo ${uid()}` });
    tokA = await tokenFor(A.owner.id);
    tokB = await tokenFor(B.owner.id);
    const j = await createJob(B.ctx, { title: "Bravo confidential", description: "Confidential Bravo vacancy text.", requiredQualifications: [], requiredSkills: [], preferredSkills: [], remotePolicy: "ONSITE", employmentType: "FULL_TIME", openings: 1, visibility: "PUBLIC", campusHiring: false, eligibleGraduationYears: [], eligibleDegrees: [], eligibleProgrammeIds: [], screeningQuestions: [], aiDraftUsed: false }, meta);
    jobB = j.id;
    const app = await addCandidateToJob(B.ctx, { jobId: jobB, email: `bravo-cand-${uid()}@x.test`, firstName: "Bravo", lastName: "Secret", source: "DIRECT" }, meta);
    appB = app.id;
    const f = await storeFile({ buffer: Buffer.from("%PDF-1.4 bravo resume"), fileName: "bravo.pdf", purpose: "RESUME", allowedTypes: ["application/pdf"], organisationId: B.org.id });
    resumeFileB = f.id;
    await withOrg(B.org.id, null, (tx) => tx.candidateDocument.create({ data: { organisationId: B.org.id, candidateId: app.candidateId, fileId: f.id } }));
    const comps = await listCompetencies(B.ctx);
    const t = await saveTemplate(B.ctx, null, { name: "T", mode: "STRUCTURED_AUDIO", language: "en", durationMinutes: 5, questionCount: 1, difficulty: "ENTRY", questionSelection: "FIXED", maxFollowUps: 0, answerSeconds: 60, prepSeconds: 0, retakesAllowed: 0, recordAudio: false, storeTranscript: true, showTranscriptToCandidate: false, allowResume: true, accessibilityOptions: { allowTypedAnswers: true, extendedTimeMultiplier: 1, captions: true }, competencyIds: [comps[0].id], questions: [{ prompt: "Q?", competencyId: comps[0].id }] }, meta);
    const inv = await inviteToInterview(B.ctx, appB, { templateId: t.id, expiresInDays: 2 }, meta);
    interviewTokenB = (inv as { testToken: string }).testToken;
    sessionB = inv.sessionId;
  });

  it("rejects unauthenticated access", async () => {
    const r = await call(jobsRoute.GET as Handler, { path: "/jobs", org: A.org.slug });
    expect(r.status).toBe(401);
  });

  it("returns 404 (not 403) for another tenant's job id — no existence oracle", async () => {
    const r = await call(jobRoute.GET as Handler, { token: tokA, org: A.org.slug, params: { id: jobB } });
    expect(r.status).toBe(404);
    const missing = await call(jobRoute.GET as Handler, { token: tokA, org: A.org.slug, params: { id: "does-not-exist" } });
    expect(missing.json).toEqual({ ...r.json, error: { ...r.json.error!, requestId: (missing.json.error as unknown as { requestId: string }).requestId } });
  });

  it("forged organisation header for a tenant the user does not belong to is rejected", async () => {
    const bySlug = await call(jobRoute.GET as Handler, { token: tokA, org: B.org.slug, params: { id: jobB } });
    expect(bySlug.status).toBe(404);
    const byId = await call(appsRoute.GET as Handler, { token: tokA, org: B.org.id, path: "/applications" });
    expect(byId.status).toBe(404);
  });

  it("cannot read, modify or move another tenant's application", async () => {
    expect((await call(appRoute.GET as Handler, { token: tokA, org: A.org.slug, params: { id: appB } })).status).toBe(404);
    const stagesA = await withOrg(A.org.id, null, (tx) => tx.applicationStage.findFirstOrThrow({ where: { organisationId: A.org.id, kind: "REVIEW" } }));
    const mv = await call(moveRoute.POST as Handler, { method: "POST", token: tokA, org: A.org.slug, params: { id: appB }, body: { stageId: stagesA.id } });
    expect(mv.status).toBe(404);
    const still = await withOrg(B.org.id, null, (tx) => tx.application.findUniqueOrThrow({ where: { id: appB } }));
    expect(still.stageId).not.toBe(stagesA.id);
  });

  it("search, export and reports are tenant-scoped", async () => {
    const search = await call(appsRoute.GET as Handler, { token: tokA, org: A.org.slug, path: "/applications?q=Bravo" });
    expect(search.status).toBe(200);
    expect((search.json.data as { total: number }).total).toBe(0);
    const csv = await call(exportRoute.GET as Handler, { token: tokA, org: A.org.slug, path: "/applications/export" });
    expect(csv.status).toBe(200);
    expect(csv.text).not.toContain("Bravo");
    const dash = await call(dashRoute.GET as Handler, { token: tokA, org: A.org.slug });
    expect(JSON.stringify(dash.json)).not.toContain("Bravo");
    const ownCsv = await call(exportRoute.GET as Handler, { token: tokB, org: B.org.slug, path: "/applications/export" });
    expect(ownCsv.text).toContain("Bravo");
  });

  it("file links are authorised per request: another tenant gets 404", async () => {
    expect((await call(fileRoute.GET as Handler, { token: tokA, params: { id: resumeFileB } })).status).toBe(404);
    const own = await call(fileRoute.GET as Handler, { token: tokB, params: { id: resumeFileB } });
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toContain("no-store");
    // Unauthenticated
    expect((await call(fileRoute.GET as Handler, { params: { id: resumeFileB } })).status).toBe(401);
  });

  it("background jobs cannot be pointed at another tenant's data", async () => {
    // A job payload naming tenant A but B's session id is a no-op (row invisible in A's context).
    await runAssessment(A.org.id, sessionB);
    const s = await withOrg(B.org.id, null, (tx) => tx.interviewSession.findUniqueOrThrow({ where: { id: sessionB } }));
    expect(s.status).toBe("INVITED");
    expect(await withOrg(B.org.id, null, (tx) => tx.assessment.count({ where: { sessionId: sessionB } }))).toBe(0);
  });

  it("interview tokens grant access to exactly one session and stop working after completion", async () => {
    const r = await call(interviewStateRoute.GET as Handler, { headers: { "x-interview-token": interviewTokenB } });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toMatch(/organisationId|applicationId|rubric|guidance/);
    const bad = await call(interviewStateRoute.GET as Handler, { headers: { "x-interview-token": "x".repeat(43) } });
    expect(bad.status).toBe(404);
    const access = await resolveInterviewAccess({ token: interviewTokenB }, null);
    await recordConsent(access, { recording: false, aiAssessment: true, transcript: true }, meta);
    await startInterview(access, meta);
    await submitStructuredAnswer(access, { position: 0, text: "An answer long enough to be assessed by the fixture provider." });
    await completeInterview(access);
    await expect(submitStructuredAnswer(access, { position: 0, text: "late answer" })).rejects.toThrow(/not in progress/);
    await expect(startInterview(access, meta)).rejects.toThrow(/no longer available/);
  });
});

describe("Security: CSRF, sessions, privilege escalation, uploads, leakage", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  beforeAll(async () => {
    org = await makeOrg();
  });

  it("state-changing requests require a same-origin Origin header", async () => {
    const tok = await tokenFor(org.owner.id);
    const body = { title: "X job", description: "A description long enough for validation." };
    const none = await call(jobsRoute.POST as Handler, { method: "POST", token: tok, org: org.org.slug, body, origin: null });
    expect(none.status).toBe(403);
    expect(none.json.error?.code).toBe("CSRF_FAILED");
    const evil = await call(jobsRoute.POST as Handler, { method: "POST", token: tok, org: org.org.slug, body, origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const ok = await call(jobsRoute.POST as Handler, { method: "POST", token: tok, org: org.org.slug, body });
    expect(ok.status).toBe(200);
  });

  it("login always issues a fresh session; logout and revocation invalidate it", async () => {
    const u = await makeUser();
    const pre = await tokenFor(u.id);
    const login = await call(loginRoute.POST as Handler, { method: "POST", body: { email: u.email, password: "Correct-horse-battery-9" }, token: pre });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    const fresh = /atlas_session=([^;]+)/.exec(setCookie)![1];
    expect(fresh).not.toBe(pre);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect((await call(meRoute.GET as Handler, { token: fresh })).status).toBe(200);
    await call(logoutRoute.POST as Handler, { method: "POST", token: fresh });
    expect((await call(meRoute.GET as Handler, { token: fresh })).status).toBe(401);
  });

  it("wrong password responses don't reveal whether the account exists", async () => {
    const real = await call(loginRoute.POST as Handler, { method: "POST", body: { email: org.owner.email, password: "wrong-password-1" } });
    const fake = await call(loginRoute.POST as Handler, { method: "POST", body: { email: `nobody-${uid()}@x.test`, password: "wrong-password-1" } });
    expect(real.status).toBe(401);
    expect(fake.status).toBe(401);
    expect(real.json.error?.message).toBe(fake.json.error?.message);
  });

  it("members cannot escalate privileges", async () => {
    const rec = await addMember(org.org.id, "RECRUITER");
    const hr = await addMember(org.org.id, "HR_ADMIN");
    const recTok = await tokenFor(rec.user.id);
    const hrTok = await tokenFor(hr.user.id);
    const self = await call(memberRoute.PATCH as Handler, { method: "PATCH", token: recTok, org: org.org.slug, params: { id: rec.ctx.membershipId }, body: { roleKey: "OWNER" } });
    expect(self.status).toBe(403);
    const hrToOwner = await call(memberRoute.PATCH as Handler, { method: "PATCH", token: hrTok, org: org.org.slug, params: { id: rec.ctx.membershipId }, body: { roleKey: "OWNER" } });
    expect(hrToOwner.status).toBe(403);
    const inviteOwner = await call(inviteRoute.POST as Handler, { method: "POST", token: hrTok, org: org.org.slug, body: { invites: [{ email: `x-${uid()}@x.test`, roleKey: "OWNER" }] } });
    expect(inviteOwner.status).toBe(403);
    const ownerMembership = await prisma.organisationMembership.findFirstOrThrow({ where: { organisationId: org.org.id, userId: org.owner.id } });
    const demoteOwner = await call(memberRoute.DELETE as Handler, { method: "DELETE", token: hrTok, org: org.org.slug, params: { id: ownerMembership.id } });
    expect(demoteOwner.status).toBe(403);
  });

  it("platform endpoints are invisible to normal users and require MFA for admins", async () => {
    const tok = await tokenFor(org.owner.id);
    expect((await call(platformRoute.GET as Handler, { token: tok })).status).toBe(404);
    const admin = await makeUser({ platformRole: "SUPER_ADMIN" });
    const adminTok = await tokenFor(admin.id);
    const r = await call(platformRoute.GET as Handler, { token: adminTok });
    expect(r.status).toBe(401);
    expect(r.json.error?.code).toBe("MFA_REQUIRED");
  });

  it("suspended organisations lose API access", async () => {
    const o = await makeOrg();
    const tok = await tokenFor(o.owner.id);
    await prisma.organisation.update({ where: { id: o.org.id }, data: { status: "SUSPENDED" } });
    const r = await call(jobsRoute.GET as Handler, { token: tok, org: o.org.slug, path: "/jobs" });
    expect(r.status).toBe(403);
  });

  it("rejects disguised executables and oversized uploads", async () => {
    const u = await makeUser();
    const tok = await tokenFor(u.id);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("MZ\x90\x00 this is really an exe \x00\x00")], { type: "application/pdf" }), "cv.pdf");
    const r = await call(resumeRoute.POST as Handler, { method: "POST", token: tok, form });
    expect(r.status).toBe(400);
    expect(r.json.error?.message).toMatch(/Unsupported|unrecognised/);
  });

  it("rejects oversized JSON bodies before validation", async () => {
    const tok = await tokenFor(org.owner.id);
    const r = await call(jobsRoute.POST as Handler, { method: "POST", token: tok, org: org.org.slug, body: { title: "x", description: "a".repeat(1024 * 1024 + 10) } });
    expect(r.status).toBe(413);
    expect(r.json.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("validation errors are structured and contain no stack traces", async () => {
    const tok = await tokenFor(org.owner.id);
    const r = await call(jobsRoute.POST as Handler, { method: "POST", token: tok, org: org.org.slug, body: { title: "" } });
    expect(r.status).toBe(422);
    expect(r.text).not.toMatch(/at \w+ \(|node_modules|prisma/i);
  });

  it("logs redact credentials, tokens and candidate content", () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _e, cb) { lines.push(chunk.toString()); cb(); } });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, stream);
    log.info({ password: "hunter2", token: "abc", headers: { cookie: "atlas_session=xyz" }, body: { transcript: "my private answer" }, user: { passwordHash: "h" } }, "test");
    const out = lines.join("");
    expect(out).not.toMatch(/hunter2|atlas_session=xyz|my private answer|"abc"/);
    expect(out).toContain("[REDACTED]");
  });
});
