import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/server/db/client";
import { withOrg } from "@/server/db/tenant";
import { register, verifyEmail, login } from "@/server/services/auth";
import { createOrganisation, inviteMembers, acceptInvitation, listMembers } from "@/server/services/organisations";
import { createJob, changeJobStatus, setJobAssignments } from "@/server/services/jobs";
import { saveTemplate, listCompetencies } from "@/server/services/templates";
import { addCandidateToJob, moveApplication, listStages, getApplication, listApplications } from "@/server/services/applications";
import { inviteToInterview, resolveInterviewAccess, getCandidateState, recordConsent, startInterview, submitStructuredAnswer, completeInterview, getInterviewForHr } from "@/server/services/interviews";
import { reviewAssessment } from "@/server/services/assessments";
import { balance } from "@/server/billing/credits";
import { resolveSessionToken } from "@/server/auth/session";
import { resolveOrgContext } from "@/server/auth/context";
import { meta, uid, sessionFor, PASSWORD } from "../helpers";
import { grant } from "@/server/billing/credits";
import type { OrgContext } from "@/server/auth/context";

import { tokenFromEmail, grantPlatformAi, ORG_AI } from "../helpers";

describe("Journey: organisation → team → vacancy → AI interview → assessment → decision", () => {
  const ownerEmail = `owner-${uid()}@acme.test`;
  let owner: OrgContext;
  let orgId: string;
  let jobId: string;
  let templateId: string;
  let applicationId: string;
  let interviewToken: string;
  let hr: OrgContext;

  beforeAll(() => {
    process.env.EXPOSE_TEST_TOKENS = "true";
  });

  it("1. registers, verifies email and creates an organisation", async () => {
    await register({ email: ownerEmail, password: PASSWORD, firstName: "Ada", lastName: "Owner", intent: "EMPLOYER", acceptTerms: true }, meta);
    // Duplicate registration is indistinguishable to the caller.
    await expect(register({ email: ownerEmail, password: PASSWORD, firstName: "X", lastName: "Y", intent: "EMPLOYER", acceptTerms: true }, meta)).resolves.toEqual({ ok: true });
    const token = await tokenFromEmail(ownerEmail, /verify-email\?token=([\w-]+)/);
    await verifyEmail(token);
    await expect(verifyEmail(token)).rejects.toThrow(/invalid or has expired/); // single use
    const l = await login(ownerEmail, PASSWORD, meta);
    const session = (await resolveSessionToken(l.token))!;
    const org = await createOrganisation(session, { name: `Acme ${uid()}`, type: "EMPLOYER", timezone: "UTC", acceptTerms: true }, meta);
    orgId = org.id;
    // Platform AI is denied by default; a super-admin grants it explicitly (FIXTURE provider in tests).
    await grantPlatformAi(orgId, ORG_AI);
    owner = await resolveOrgContext(session, org.slug);
    expect(owner.roleKey).toBe("OWNER");
    const stages = await listStages(owner);
    expect(stages.map((s) => s.kind)).toContain("AI_INTERVIEW_INVITED");
    await withOrg(orgId, owner.userId, (tx) => grant(tx, { organisationId: orgId }, 5, "GRANT_PURCHASE", `flow:${orgId}`));
  });

  it("2. owner invites multiple HR employees; invitations are email-bound and single-use", async () => {
    await prisma.platformSetting.upsert({ where: { key: "entitlements.default" }, create: { key: "entitlements.default", value: { seats: "10" } }, update: { value: { seats: "10", monthly_interview_credits: "0" } } });
    const hrEmail = `hr-${uid()}@acme.test`;
    const recEmail = `rec-${uid()}@acme.test`;
    const r = await inviteMembers(owner, { invites: [{ email: hrEmail, roleKey: "HR_ADMIN" }, { email: recEmail, roleKey: "RECRUITER" }] }, meta);
    expect(r.results.map((x) => x.status)).toEqual(["invited", "invited"]);
    const hrToken = await tokenFromEmail(hrEmail, /accept-invite\?token=([\w-]+)/);
    const recToken = await tokenFromEmail(recEmail, /accept-invite\?token=([\w-]+)/);

    const hrUser = await prisma.user.create({ data: { email: hrEmail, emailVerifiedAt: new Date(), profile: { create: { firstName: "Hana", lastName: "HR" } } } });
    const intruder = await prisma.user.create({ data: { email: `intruder-${uid()}@evil.test`, emailVerifiedAt: new Date(), profile: { create: { firstName: "I", lastName: "X" } } } });
    await expect(acceptInvitation(await sessionFor(intruder.id), hrToken, meta)).rejects.toThrow(/different email/);
    const hrSession = await sessionFor(hrUser.id);
    await acceptInvitation(hrSession, hrToken, meta);
    await expect(acceptInvitation(hrSession, hrToken, meta)).rejects.toThrow(/already been used|invalid/);
    hr = await resolveOrgContext(await sessionFor(hrUser.id), orgId);
    expect(hr.roleKey).toBe("HR_ADMIN");
    expect(hr.can("billing.manage")).toBe(false);

    const recUser = await prisma.user.create({ data: { email: recEmail, emailVerifiedAt: new Date(), profile: { create: { firstName: "Rex", lastName: "Rec" } } } });
    await acceptInvitation(await sessionFor(recUser.id), recToken, meta);
    const members = await listMembers(owner);
    expect(members.members.length).toBe(3);
  });

  it("3. HR creates a vacancy; AI-drafted jobs need explicit human review to publish", async () => {
    const job = await createJob(hr, {
      title: "Data Analyst",
      description: "Analyse product data and present insights to stakeholders across the business.",
      requiredQualifications: ["Degree or equivalent experience"],
      requiredSkills: ["SQL"],
      preferredSkills: ["Python"],
      remotePolicy: "REMOTE",
      employmentType: "FULL_TIME",
      openings: 1,
      visibility: "PUBLIC",
      campusHiring: false,
      eligibleGraduationYears: [],
      eligibleDegrees: [],
      eligibleProgrammeIds: [],
      screeningQuestions: [],
      aiDraftUsed: true,
    }, meta);
    jobId = job.id;
    await expect(changeJobStatus(hr, jobId, "publish", {}, meta)).rejects.toThrow(/Confirm you have reviewed/);
    const published = await changeJobStatus(hr, jobId, "publish", { confirmHumanReview: true }, meta);
    expect(published.status).toBe("PUBLISHED");
    expect(published.aiDraftReviewedById).toBe(hr.userId);
    await expect(changeJobStatus(hr, jobId, "publish", {}, meta)).rejects.toThrow(/Cannot publish/);
  });

  it("4. HR configures a structured AI interview template", async () => {
    const comps = await listCompetencies(hr);
    const ids = comps.slice(0, 2).map((c) => c.id);
    const t = await saveTemplate(hr, null, {
      name: "Analyst screen",
      mode: "STRUCTURED_AUDIO",
      language: "en",
      durationMinutes: 15,
      questionCount: 2,
      difficulty: "INTERMEDIATE",
      questionSelection: "FIXED",
      maxFollowUps: 0,
      answerSeconds: 90,
      prepSeconds: 10,
      retakesAllowed: 1,
      recordAudio: true,
      storeTranscript: true,
      showTranscriptToCandidate: false,
      allowResume: true,
      accessibilityOptions: { allowTypedAnswers: true, extendedTimeMultiplier: 1, captions: true },
      competencyIds: ids,
      questions: [
        { prompt: "Tell me about a time you explained data to a non-technical audience.", competencyId: ids[0] },
        { prompt: "Describe how you diagnosed a data quality problem.", competencyId: ids[1] },
      ],
    }, meta);
    templateId = t.id;
    expect(t.questions.length).toBe(2);
  });

  it("5. candidate receives an invitation and a credit is reserved", async () => {
    const app = await addCandidateToJob(hr, { jobId, email: `cand-${uid()}@mail.test`, firstName: "Cara", lastName: "Candidate", source: "DIRECT" }, meta);
    applicationId = app.id;
    const before = await withOrg(orgId, null, (tx) => balance(tx, { organisationId: orgId }));
    const inv = await inviteToInterview(hr, applicationId, { templateId, expiresInDays: 7 }, meta);
    interviewToken = (inv as { testToken: string }).testToken;
    expect(interviewToken).toBeTruthy();
    const after = await withOrg(orgId, null, (tx) => balance(tx, { organisationId: orgId }));
    expect(after.available).toBe(before.available - 1);
    expect(after.reserved).toBe(before.reserved + 1);
    await expect(inviteToInterview(hr, applicationId, { templateId, expiresInDays: 7 }, meta)).rejects.toThrow(/already has an interview/);
    const appDetail = await getApplication(hr, applicationId);
    expect(appDetail.stage?.kind).toBe("AI_INTERVIEW_INVITED");
  });

  it("6. candidate completes the structured interview (typed + audio answers, retake)", async () => {
    const access = await resolveInterviewAccess({ token: interviewToken }, null);
    let state = await getCandidateState(access);
    expect(state.status).toBe("INVITED");
    expect(JSON.stringify(state)).not.toMatch(/guidance|rubric/i);
    await expect(startInterview(access, meta)).rejects.toThrow(/accept the interview notice/);
    const c = await recordConsent(access, { recording: true, aiAssessment: true, transcript: true }, meta);
    expect(c.ready).toBe(true);
    const started = (await startInterview(access, meta)) as { question: { position: number } };
    expect(started.question.position).toBe(0);
    // Wrong position is rejected.
    await expect(submitStructuredAnswer(access, { position: 1, text: "skip ahead" })).rejects.toThrow(/does not match/);
    const r1 = await submitStructuredAnswer(access, { position: 0, text: "I presented a dashboard to the sales team, explained each metric with examples, and they adopted it for weekly planning.", idempotencyKey: "a1" });
    expect(r1.done).toBe(false);
    // Idempotent retry of the same submission does not create a duplicate.
    await submitStructuredAnswer(access, { position: 0, text: "dup", idempotencyKey: "a1" });
    // Retake of the last answer (1 allowed).
    state = await getCandidateState(access);
    expect(state.canRetakeLast).toBe(true);
    await submitStructuredAnswer(access, { position: 0, text: "I presented a sales dashboard, walked through each metric with real examples, and the team adopted it for weekly planning.", retake: true });
    await expect(submitStructuredAnswer(access, { position: 0, text: "again", retake: true })).rejects.toThrow(/No retakes/);
    // Audio answer (fixture STT) — a real WebM header so sniffing accepts it.
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200, 1)]);
    const r2 = await submitStructuredAnswer(access, { position: 1, audio: { buffer: webm, fileName: "a.webm" }, durationMs: 8000 });
    expect(r2.done).toBe(true);
    await completeInterview(access);
    await completeInterview(access); // idempotent
    state = await getCandidateState(access);
    expect(state.status).toBe("COMPLETED");
  });

  it("7. assessment is generated with verified evidence; credit consumed; HR reviews", async () => {
    const app = await getApplication(hr, applicationId);
    const s = app.sessions[0];
    expect(["ASSESSED", "REQUIRES_REVIEW"]).toContain(s.status);
    expect(s.providerMode).toBe("FIXTURE"); // labelled honestly
    const a = s.assessment!;
    expect(a.results.length).toBe(2);
    for (const r of a.results.filter((r) => r.rating !== "INSUFFICIENT_EVIDENCE")) {
      expect(r.evidence.some((e) => e.verified)).toBe(true);
      expect(r.rubricVersion).toBe(1);
    }
    expect(a.promptVersion).toBe("assess.v1");
    const bal = await withOrg(orgId, null, (tx) => balance(tx, { organisationId: orgId }));
    expect(bal.reserved).toBe(0);
    const sessionRow = await withOrg(orgId, null, (tx) => tx.interviewSession.findFirstOrThrow({ where: { id: s.id } }));
    expect(sessionRow.billingOutcome).toBe("CONSUMED");

    const hrView = await getInterviewForHr(hr, s.id);
    expect(hrView.transcript.length).toBeGreaterThan(0);
    expect(hrView.audio.length).toBe(1); // recording consented and template stores audio
    const answers = hrView.answers.filter((x) => x.position === 0);
    expect(answers.map((x) => x.attempt)).toEqual([1, 2]);

    const review = await reviewAssessment(hr, s.id, { decision: "ADJUSTED", notes: "Calibrated", overrides: [{ competencyId: a.results[0].competencyId, rating: "R4", reason: "Clear, specific example with outcome" }] }, meta);
    expect(review.decision).toBe("ADJUSTED");
    const after = await getApplication(hr, applicationId);
    expect(after.sessions[0].status).toBe("REVIEWED");
    expect(after.sessions[0].assessment!.results.find((r) => r.competencyId === a.results[0].competencyId)!.humanRating).toBe("R4");
  });

  it("8. HR records a hiring-stage decision with reason; recruiters without decision rights cannot", async () => {
    const stages = await listStages(hr);
    const hired = stages.find((s) => s.kind === "HIRED")!;
    const rec = (await prisma.organisationMembership.findMany({ where: { organisationId: orgId, role: { key: "RECRUITER" } } }))[0];
    const recCtx = await resolveOrgContext(await sessionFor(rec.userId), orgId);
    // Recruiter is assignment-scoped: not assigned → cannot even see it.
    expect((await listApplications(recCtx, { page: 1, pageSize: 50 })).total).toBe(0);
    await setJobAssignments(hr, jobId, { assignments: [{ userId: rec.userId, role: "RECRUITER" }, { userId: hr.userId, role: "HIRING_MANAGER" }] }, meta);
    expect((await listApplications(recCtx, { page: 1, pageSize: 50 })).total).toBe(1);
    await expect(moveApplication(recCtx, applicationId, { stageId: hired.id, reason: "great", notifyCandidate: false }, meta)).rejects.toThrow(/decision permission/);
    await expect(moveApplication(hr, applicationId, { stageId: hired.id, notifyCandidate: false }, meta)).rejects.toThrow(/reason/);
    const moved = await moveApplication(hr, applicationId, { stageId: hired.id, reason: "Strong evidence across competencies", notifyCandidate: true }, meta);
    expect(moved.status).toBe("HIRED");
    const detail = await getApplication(hr, applicationId);
    expect(detail.history.at(-1)?.toStatus).toBe("HIRED");
    const audit = await prisma.auditEvent.findFirst({ where: { organisationId: orgId, action: "application.decided" } });
    expect(audit).not.toBeNull();
  });
});
