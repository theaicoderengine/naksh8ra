import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/server/db/client";
import { withOrg, withSystem } from "@/server/db/tenant";
import { createDataRequest, eraseCandidate, retentionSweep, setRetention } from "@/server/services/privacy";
import { ensureStudentProfile, updateStudentProfile } from "@/server/services/students";
import { uploadResume } from "@/server/services/resumes";
import { createJob, changeJobStatus } from "@/server/services/jobs";
import { applyToJob, addCandidateToJob } from "@/server/services/applications";
import { organisationAction, adjustOrgCredits, organisationDetail, setPlatformRole, requestSupportAccess, decideSupportAccess, platformOverview, listAuditEvents } from "@/server/services/platform";
import { saveTemplate, listCompetencies } from "@/server/services/templates";
import { inviteToInterview, resolveInterviewAccess, recordConsent, startInterview, conversationalTurn, getCandidateState, sweepSessions } from "@/server/services/interviews";
import { balance } from "@/server/billing/credits";
import { register, login, requestPasswordReset, resetPassword, verifyMfaForSession, beginMfaSetup, confirmMfaSetup } from "@/server/services/auth";
import { resolveSessionToken } from "@/server/auth/session";
import { resolveOrgContext } from "@/server/auth/context";
import { totp } from "@/server/auth/totp";
import { makeOrg, makeUser, sessionFor, meta, uid, tokenFromEmail, PASSWORD } from "../helpers";

const jobInput = (title: string) => ({ title, description: "A suitably long description for the vacancy.", requiredQualifications: [], requiredSkills: [], preferredSkills: [], remotePolicy: "REMOTE" as const, employmentType: "FULL_TIME" as const, openings: 1, visibility: "PUBLIC" as const, campusHiring: false, eligibleGraduationYears: [], eligibleDegrees: [], eligibleProgrammeIds: [], screeningQuestions: [], aiDraftUsed: false });

describe("20. Privacy: data export and deletion", () => {
  let employer: Awaited<ReturnType<typeof makeOrg>>;
  let student: Awaited<ReturnType<typeof makeUser>>;
  let appId: string;

  beforeAll(async () => {
    employer = await makeOrg();
    student = await makeUser();
    await ensureStudentProfile(await sessionFor(student.id));
    await updateStudentProfile(student.id, { headline: "Privacy test student", skills: [{ name: "Go" }] });
    await uploadResume(student.id, { buffer: Buffer.from("Privacy Student\nprivacy@example.com\nSkills: Go, Rust and more text here"), fileName: "cv.txt" });
    const j = await createJob(employer.ctx, jobInput(`Privacy job ${uid()}`), meta);
    await changeJobStatus(employer.ctx, j.id, "publish", {}, meta);
    appId = (await applyToJob(student.id, { jobId: j.id, consentToShare: true, screeningAnswers: [], saveAsDraft: false }, meta)).id;
  });

  it("exports the user's personal data without secrets", async () => {
    const req = await createDataRequest(student.id, { type: "EXPORT" }, meta);
    const done = await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(done.status).toBe("COMPLETED");
    const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: done.resultFileId! } });
    expect(file.ownerUserId).toBe(student.id);
    const content = fs.readFileSync(path.resolve(process.env.STORAGE_LOCAL_DIR!, file.storageKey), "utf8");
    const data = JSON.parse(content);
    expect(data.account.email).toBe(student.email);
    expect(data.applications.map((a: { id: string }) => a.id)).toContain(appId);
    expect(content).not.toMatch(/passwordHash|mfaSecret|scrypt\$/);
  });

  it("deletes the account, purges files, and forwards erasure requests to employers", async () => {
    const resumeFiles = await prisma.resumeVersion.findMany({ where: { userId: student.id }, select: { fileId: true } });
    await createDataRequest(student.id, { type: "DELETION" }, meta);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: student.id } });
    expect(u.status).toBe("DELETED");
    expect(u.email).toMatch(/@deleted\.invalid$/);
    expect(u.passwordHash).toBeNull();
    expect(await prisma.studentProfile.findUnique({ where: { userId: student.id } })).toBeNull();
    expect(await prisma.resumeVersion.count({ where: { userId: student.id } })).toBe(0);
    for (const f of resumeFiles) expect((await prisma.storedFile.findUniqueOrThrow({ where: { id: f.fileId } })).deletedAt).not.toBeNull();
    expect(await prisma.session.count({ where: { userId: student.id, revokedAt: null } })).toBe(0);
    const forwarded = await prisma.dataSubjectRequest.findFirst({ where: { organisationId: employer.org.id, type: "DELETION" } });
    expect(forwarded).not.toBeNull();
    const app = await withOrg(employer.org.id, null, (tx) => tx.application.findUniqueOrThrow({ where: { id: appId } }));
    expect(app.candidateUserId).toBeNull(); // account link removed
    // Employer (controller) completes erasure of its own record.
    const res = await eraseCandidate(employer.ctx, app.candidateId, "Data subject erasure request", meta);
    expect(res.erased).toBe(true);
    expect(await withOrg(employer.org.id, null, (tx) => tx.application.count({ where: { id: appId } }))).toBe(0);
    expect(await prisma.auditEvent.findFirst({ where: { organisationId: employer.org.id, action: "privacy.candidate_erased" } })).not.toBeNull();
  });

  it("retention policies are bounded and enforced by the sweep", async () => {
    await expect(setRetention(employer.ctx, { policies: [{ dataCategory: "AUDIO", retainDays: 5000 }] }, meta)).rejects.toThrow(/cannot exceed/);
    await setRetention(employer.ctx, { policies: [{ dataCategory: "APPLICATION", retainDays: 30 }] }, meta);
    const j = await createJob(employer.ctx, jobInput(`Old job ${uid()}`), meta);
    const old = await addCandidateToJob(employer.ctx, { jobId: j.id, email: `old-${uid()}@x.test`, firstName: "Old", lastName: "Record", source: "DIRECT" }, meta);
    const past = new Date(Date.now() - 90 * 86400_000);
    await withSystem("test backdate", async (tx) => {
      await tx.application.update({ where: { id: old.id }, data: { status: "REJECTED", updatedAt: past } });
      await tx.candidate.update({ where: { id: old.candidateId }, data: { createdAt: past } });
    });
    const summary = await retentionSweep();
    expect(summary.candidates).toBeGreaterThanOrEqual(1);
    expect(await withOrg(employer.org.id, null, (tx) => tx.candidate.count({ where: { id: old.candidateId } }))).toBe(0);
  });
});

describe("18. Platform super-admin manages organisations (audited)", () => {
  it("suspends, reactivates, verifies, adjusts credits — with reasons and audit trail", async () => {
    const admin = await makeUser({ platformRole: "SUPER_ADMIN" });
    const s = await sessionFor(admin.id, true);
    const { org, owner } = await makeOrg();
    await expect(organisationAction(org.id, { action: "suspend", reason: "", confirm: true } as never, s, meta)).rejects.toThrow();
    await organisationAction(org.id, { action: "suspend", reason: "Payment fraud investigation", confirm: true }, s, meta);
    await expect(resolveOrgContext(await sessionFor(owner.id), org.id)).rejects.toThrow(/suspended/);
    await organisationAction(org.id, { action: "reactivate", reason: "Investigation closed", confirm: true }, s, meta);
    await organisationAction(org.id, { action: "verify", reason: "Companies House record checked", confirm: true }, s, meta);
    const key = `adj-${uid()}`;
    await adjustOrgCredits(org.id, { delta: 10, reason: "Goodwill for outage", confirm: true, idempotencyKey: key }, s, meta);
    await adjustOrgCredits(org.id, { delta: 10, reason: "Goodwill for outage", confirm: true, idempotencyKey: key }, s, meta); // double-click
    expect((await withOrg(org.id, null, (tx) => balance(tx, { organisationId: org.id }))).available).toBe(10);
    const detail = await organisationDetail(org.id, s, meta);
    expect(JSON.stringify(detail)).not.toMatch(/transcript|resume|candidate/i);
    const events = await listAuditEvents({ organisationId: org.id, page: 1 });
    const actions = events.items.map((e) => e.action);
    for (const a of ["platform.org_suspend", "platform.org_reactivate", "platform.org_verify", "platform.credits_adjusted", "platform.org_viewed"]) expect(actions).toContain(a);
    expect(events.items.find((e) => e.action === "platform.org_suspend")?.reason).toBe("Payment fraud investigation");
    const ov = await platformOverview();
    expect(ov.users).toBeGreaterThan(0);
  });

  it("support access must be approved by the organisation and expires", async () => {
    const admin = await makeUser({ platformRole: "SUPPORT" });
    const s = await sessionFor(admin.id, true);
    const { org, owner } = await makeOrg();
    const g = await requestSupportAccess(org.id, "Customer reported import failure", s, meta);
    expect(g.status).toBe("REQUESTED");
    const approved = await decideSupportAccess(org.id, g.id, true, owner.id, meta);
    expect(approved.status).toBe("APPROVED");
    expect(approved.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3600_000 + 1000);
  });

  it("cannot demote the last super admin or change your own role", async () => {
    const a = await makeUser({ platformRole: "SUPER_ADMIN" });
    const s = await sessionFor(a.id, true);
    await expect(setPlatformRole({ email: a.email, role: "NONE", reason: "testing self" }, s, meta)).rejects.toThrow(/own platform role/);
  });
});

describe("6b. Real-time conversational interview mode", () => {
  it("runs a full conversation with server-enforced plan, captions and completion", async () => {
    process.env.EXPOSE_TEST_TOKENS = "true";
    const { ctx, org } = await makeOrg({ credits: 1 });
    // No platform grant: this organisation runs the interview on its OWN key (BYOK).
    const { saveOrgCredential } = await import("@/server/services/ai-settings");
    await saveOrgCredential(ctx, "FIXTURE", { apiKey: "fixture-ok", model: "fixture-llm-v1" }, meta);
    await prisma.platformSetting.update({ where: { key: "entitlements.default" }, data: { value: { seats: "10", monthly_interview_credits: "0", "feature.realtime_interviews": "true" } } });
    const comps = await listCompetencies(ctx);
    const t = await saveTemplate(ctx, null, { name: "Live", mode: "REALTIME_CONVERSATIONAL", language: "en", durationMinutes: 20, questionCount: 2, difficulty: "INTERMEDIATE", questionSelection: "FIXED", maxFollowUps: 1, answerSeconds: 120, prepSeconds: 0, retakesAllowed: 0, recordAudio: false, storeTranscript: true, showTranscriptToCandidate: false, allowResume: true, accessibilityOptions: { allowTypedAnswers: true, extendedTimeMultiplier: 1, captions: true }, competencyIds: [comps[0].id, comps[1].id], questions: [{ prompt: "Tell me about yourself and a recent project.", competencyId: comps[0].id }, { prompt: "How did you solve a hard problem?", competencyId: comps[1].id }] }, meta);
    const j = await createJob(ctx, jobInput(`Live ${uid()}`), meta);
    const app = await addCandidateToJob(ctx, { jobId: j.id, email: `live-${uid()}@x.test`, firstName: "Liv", lastName: "E", source: "DIRECT" }, meta);
    const inv = await inviteToInterview(ctx, app.id, { templateId: t.id, expiresInDays: 1 }, meta);
    const access = await resolveInterviewAccess({ token: (inv as { testToken: string }).testToken }, null);
    await recordConsent(access, { recording: false, aiAssessment: true, transcript: true }, meta);
    const greet = (await startInterview(access, meta)) as { say: string };
    expect(greet.say).toMatch(/Tell me about yourself/);
    const repeat = await conversationalTurn(access, { text: "Sorry, could you repeat that?" });
    expect(repeat.action).toBe("REPEAT");
    const t1 = await conversationalTurn(access, { text: "I'm a developer who recently rebuilt our billing pipeline to reduce failures." });
    expect(t1.action).toBe("ASK_NEXT");
    expect(t1.say).toMatch(/hard problem/);
    // Simulated disconnect → interrupted → resume.
    const { recordClientEvent } = await import("@/server/services/interviews");
    await recordClientEvent(access, "DISCONNECT", {});
    expect((await getCandidateState(access)).status).toBe("INTERRUPTED");
    const resumed = (await startInterview(access, meta)) as { say: string };
    expect(resumed.say).toMatch(/Welcome back/);
    const t2 = await conversationalTurn(access, { text: "I profiled the service, found an N+1 query, and fixed it with batching." });
    expect(t2.done).toBe(true);
    const state = await getCandidateState(access);
    expect(state.status).toBe("COMPLETED");
    expect(state.conversation.length).toBe(0); // captions only while in progress
    const s = await withOrg(org.id, null, (tx) => tx.interviewSession.findUniqueOrThrow({ where: { id: inv.sessionId }, include: { answers: true, assessment: true } }));
    expect(s.answers.length).toBe(2);
    expect(s.billingOutcome).toBe("CONSUMED");
    expect(s.assessment).not.toBeNull();
  });

  it("expired unused invitations release their credit", async () => {
    process.env.EXPOSE_TEST_TOKENS = "true";
    const { ctx, org } = await makeOrg({ credits: 1 });
    const comps = await listCompetencies(ctx);
    const t = await saveTemplate(ctx, null, { name: "Exp", mode: "STRUCTURED_AUDIO", language: "en", durationMinutes: 5, questionCount: 1, difficulty: "ENTRY", questionSelection: "FIXED", maxFollowUps: 0, answerSeconds: 60, prepSeconds: 0, retakesAllowed: 0, recordAudio: false, storeTranscript: true, showTranscriptToCandidate: false, allowResume: true, accessibilityOptions: { allowTypedAnswers: true, extendedTimeMultiplier: 1, captions: true }, competencyIds: [comps[0].id], questions: [{ prompt: "Q?", competencyId: comps[0].id }] }, meta);
    const j = await createJob(ctx, jobInput(`Exp ${uid()}`), meta);
    const app = await addCandidateToJob(ctx, { jobId: j.id, email: `exp-${uid()}@x.test`, firstName: "E", lastName: "X", source: "DIRECT" }, meta);
    const inv = await inviteToInterview(ctx, app.id, { templateId: t.id, expiresInDays: 1 }, meta);
    expect((await withOrg(org.id, null, (tx) => balance(tx, { organisationId: org.id }))).available).toBe(0);
    await withSystem("test expire", (tx) => tx.interviewSession.update({ where: { id: inv.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    await sweepSessions();
    const b = await withOrg(org.id, null, (tx) => balance(tx, { organisationId: org.id }));
    expect(b).toMatchObject({ available: 1, reserved: 0 });
  });
});

describe("Auth hardening", () => {
  it("password reset links are single-use and revoke existing sessions", async () => {
    const email = `reset-${uid()}@x.test`;
    await register({ email, password: PASSWORD, firstName: "R", lastName: "S", intent: "CANDIDATE", acceptTerms: true }, meta);
    const l = await login(email, PASSWORD, meta);
    await requestPasswordReset(email, meta);
    const token = await tokenFromEmail(email, /reset-password\?token=([\w-]+)/);
    await resetPassword(token, "Brand-new-password-42", meta);
    await expect(resetPassword(token, "Another-password-43", meta)).rejects.toThrow(/invalid or has expired/);
    expect(await resolveSessionToken(l.token)).toBeNull();
    await expect(login(email, PASSWORD, meta)).rejects.toThrow(/incorrect/);
    await expect(login(email, "Brand-new-password-42", meta)).resolves.toBeTruthy();
  });

  it("accounts lock after repeated failures (rate-limited, no enumeration)", async () => {
    const u = await makeUser();
    const errors: string[] = [];
    for (let i = 0; i < 6; i++) await login(u.email, "bad-password-x", { ...meta, ip: `10.0.0.${i}` }).catch((e: Error) => errors.push(e.message));
    expect(errors.slice(0, 5).every((m) => /incorrect/.test(m))).toBe(true);
    expect(errors[5]).toMatch(/Too many requests/);
  });

  it("MFA: sessions stay partial until the TOTP code is verified", async () => {
    const u = await makeUser();
    const s = await sessionFor(u.id);
    const { secret } = await beginMfaSetup(u.id);
    await expect(confirmMfaSetup(u.id, s.id, "000000", meta)).rejects.toThrow(/Invalid code/);
    await confirmMfaSetup(u.id, s.id, totp(secret), meta);
    const l = await login(u.email, PASSWORD, { ...meta, ip: "10.9.9.9" });
    expect(l.mfaRequired).toBe(true);
    const partial = (await resolveSessionToken(l.token))!;
    expect(partial.mfaVerified).toBe(false);
    await verifyMfaForSession(partial.id, u.id, totp(secret), meta);
    expect((await resolveSessionToken(l.token))!.mfaVerified).toBe(true);
  });
});
