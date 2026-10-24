import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/server/db/client";
import { withOrg } from "@/server/db/tenant";
import { createJob, changeJobStatus, discoverJobs, getPublicJob, toggleSavedJob, listSavedJobs, recommendJobs } from "@/server/services/jobs";
import { ensureStudentProfile, updateStudentProfile, studentDashboard, respondCohortInvite, listCohortInvites } from "@/server/services/students";
import { uploadResume, listResumes } from "@/server/services/resumes";
import { applyToJob, buildSharedProfile, getMyApplication, listMyApplications, withdrawApplication, draftDisclosure, setDisclosureStatus, addNote, getApplication } from "@/server/services/applications";
import { saveTemplate, listCompetencies } from "@/server/services/templates";
import { inviteToInterview, resolveInterviewAccess, recordConsent, startInterview, submitStructuredAnswer, completeInterview } from "@/server/services/interviews";
import { startPractice, answerPractice, completePractice, getPractice, practiceBalance, listPractice } from "@/server/services/practice";
import { createCohort, inviteStudents, cohortMembers, cohortAnalytics, saveProgramme } from "@/server/services/universities";
import { makeOrg, makeUser, sessionFor, meta, uid } from "../helpers";

describe("Journey: student portal, private practice, university cohort", () => {
  let employer: Awaited<ReturnType<typeof makeOrg>>;
  let uni: Awaited<ReturnType<typeof makeOrg>>;
  let student: Awaited<ReturnType<typeof makeUser>>;
  let jobId: string;
  let restrictedJobId: string;
  let applicationId: string;
  let templateId: string;

  beforeAll(async () => {
    process.env.EXPOSE_TEST_TOKENS = "true";
    employer = await makeOrg({ credits: 5 });
    uni = await makeOrg({ type: "UNIVERSITY" });
    student = await makeUser({ firstName: "Sasha" });
    const base = { requiredQualifications: [], requiredSkills: ["SQL", "Python"], preferredSkills: ["Tableau"], remotePolicy: "REMOTE" as const, employmentType: "GRADUATE_PROGRAMME" as const, openings: 2, visibility: "PUBLIC" as const, campusHiring: true, eligibleDegrees: [], eligibleProgrammeIds: [], screeningQuestions: [{ id: "q1", question: "Why this role?", required: true }], aiDraftUsed: false };
    const j = await createJob(employer.ctx, { ...base, title: `Graduate Analyst ${uid()}`, description: "Work on data products with mentoring from senior analysts.", eligibleGraduationYears: [2027] }, meta);
    jobId = j.id;
    await changeJobStatus(employer.ctx, jobId, "publish", {}, meta);
    const r = await createJob(employer.ctx, { ...base, title: `Senior role ${uid()}`, description: "Requires a specific graduation window to apply here.", eligibleGraduationYears: [2019] }, meta);
    restrictedJobId = r.id;
    await changeJobStatus(employer.ctx, restrictedJobId, "publish", {}, meta);
    const comps = await listCompetencies(employer.ctx);
    const t = await saveTemplate(employer.ctx, null, { name: "Grad screen", mode: "STRUCTURED_AUDIO", language: "en", durationMinutes: 10, questionCount: 1, difficulty: "ENTRY", questionSelection: "FIXED", maxFollowUps: 0, answerSeconds: 60, prepSeconds: 0, retakesAllowed: 0, recordAudio: false, storeTranscript: true, showTranscriptToCandidate: false, allowResume: true, accessibilityOptions: { allowTypedAnswers: true, extendedTimeMultiplier: 1, captions: true }, competencyIds: [comps[0].id], questions: [{ prompt: "Tell us about a project you are proud of.", competencyId: comps[0].id }] }, meta);
    templateId = t.id;
  });

  it("9. student registers and completes a profile with a resume", async () => {
    const s = await sessionFor(student.id);
    await ensureStudentProfile(s);
    await updateStudentProfile(student.id, {
      headline: "Final-year data science student",
      country: "GB",
      graduationYear: 2027,
      currentDegree: "BSc Data Science",
      skills: [{ name: "SQL" }, { name: "Python" }, { name: "Statistics" }],
      education: [{ institution: "Riverside", degree: "BSc Data Science", graduationYear: 2027 }],
      preferences: { desiredRoles: ["analyst"], remotePolicies: ["REMOTE"], desiredLocations: [], employmentTypes: [], opportunityAlerts: false },
      visibility: "PRIVATE",
      completeOnboarding: true,
    });
    const rv = await uploadResume(student.id, { buffer: Buffer.from("Sasha Test\nData science student\nsasha@example.com\nSkills: SQL, Python\nProjects and experience follow here."), fileName: "cv.txt" });
    expect(rv.label).toBe("cv.txt");
    const resumes = await listResumes(student.id);
    expect(["PARSED", "NEEDS_REVIEW"]).toContain(resumes[0].parseStatus); // parsed by the (inline) worker
    const dash = await studentDashboard(student.id);
    expect(dash.completion.percent).toBeGreaterThanOrEqual(80);
    // Profile is not public by default.
    expect((await prisma.studentProfile.findUniqueOrThrow({ where: { userId: student.id } })).visibility).toBe("PRIVATE");
  });

  it("10. student discovers eligible jobs, saves one and applies with a previewed profile", async () => {
    const found = await discoverJobs(student.id, { page: 1, pageSize: 50, q: "Graduate Analyst" });
    const job = found.items.find((j) => j.id === jobId)!;
    expect(job.eligibility.eligible).toBe(true);
    expect(job.organisation.verificationStatus).toBe("UNVERIFIED"); // shown as unverified, never as verified
    const restricted = await getPublicJob(student.id, restrictedJobId);
    expect(restricted.eligibility.eligible).toBe(false);
    const recs = await recommendJobs(student.id);
    expect(recs.find((r) => r.id === jobId)?.why.join(" ")).toMatch(/skills|Graduation/);
    await toggleSavedJob(student.id, jobId, true);
    expect((await listSavedJobs(student.id)).map((s) => s.job?.id)).toContain(jobId);

    const resume = (await listResumes(student.id))[0];
    const preview = await buildSharedProfile(student.id, resume.id);
    expect(preview).not.toHaveProperty("accommodations");
    expect(JSON.stringify(preview)).not.toMatch(/practice/i);

    await expect(applyToJob(student.id, { jobId: restrictedJobId, consentToShare: true, screeningAnswers: [{ id: "q1", answer: "x" }], saveAsDraft: false }, meta)).rejects.toThrow(/eligibility/);
    await expect(applyToJob(student.id, { jobId, consentToShare: true, screeningAnswers: [], saveAsDraft: false }, meta)).rejects.toThrow(/Why this role/);
    const draft = await applyToJob(student.id, { jobId, consentToShare: true, screeningAnswers: [], saveAsDraft: true }, meta);
    expect(draft.status).toBe("DRAFT");
    const app = await applyToJob(student.id, { jobId, resumeVersionId: resume.id, consentToShare: true, screeningAnswers: [{ id: "q1", answer: "I love data." }], saveAsDraft: false }, meta);
    expect(app.status).toBe("SUBMITTED");
    expect(app.id).toBe(draft.id); // draft promoted, not duplicated
    applicationId = app.id;
    await expect(applyToJob(student.id, { jobId, consentToShare: true, screeningAnswers: [{ id: "q1", answer: "again" }], saveAsDraft: false }, meta)).rejects.toThrow(/already applied/);
    const mine = await listMyApplications(student.id);
    expect(mine.find((a) => a.id === app.id)?.job?.title).toMatch(/Graduate Analyst/);
    // Employer receives a copy of the resume in its own tenant scope.
    const hrView = await getApplication(employer.ctx, app.id);
    expect(hrView.files.length).toBe(1);
    expect(hrView.candidate.source).toBe("STUDENT_PORTAL");
  });

  it("11. student receives and completes an employer interview — one identity, one charge", async () => {
    const inv = await inviteToInterview(employer.ctx, applicationId, { templateId, expiresInDays: 3 }, meta);
    const candidates = await withOrg(employer.org.id, null, (tx) => tx.candidate.count({ where: { userId: student.id } }));
    expect(candidates).toBe(1);
    // Authenticated owner access (dashboard link) works without the token…
    const access = await resolveInterviewAccess({ invitationId: inv.invitationId }, await sessionFor(student.id));
    // …but another account cannot use the invitation id.
    const other = await makeUser();
    await expect(resolveInterviewAccess({ invitationId: inv.invitationId }, await sessionFor(other.id))).rejects.toThrow(/not found/);
    await recordConsent(access, { recording: false, aiAssessment: true, transcript: true }, meta);
    await startInterview(access, meta);
    await submitStructuredAnswer(access, { position: 0, text: "I built a forecasting model for a student society budget and presented the results to the committee." });
    await completeInterview(access);
    // The student's own practice credits are untouched by employer interviews.
    const bal = await practiceBalance(student.id);
    expect(bal.reserved).toBe(0);
  });

  it("12. private practice interview: student-billed, coaching feedback, invisible to employers", async () => {
    const before = await practiceBalance(student.id);
    const p = await startPractice(student.id, { targetRole: "Data analyst", focus: "ROLE_SPECIFIC", language: "en", mode: "STRUCTURED_AUDIO", durationMinutes: 10, questionCount: 2 });
    expect(p.providerMode).toBe("FIXTURE");
    const mid = await practiceBalance(student.id);
    expect(mid.available).toBe(before.available - 1);
    await answerPractice(student.id, p.id, { text: "I would clarify the question, gather data, and present findings clearly." });
    const r = await answerPractice(student.id, p.id, { text: "I learned to check data quality first." });
    expect(r.done).toBe(true);
    await completePractice(student.id, p.id);
    const done = await getPractice(student.id, p.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.feedback?.summary).toBeTruthy();
    expect((await listPractice(student.id)).length).toBe(1);
    // Employer org has no access path to practice data: it's not tenant-owned and no employer query references it.
    const employerSees = await withOrg(employer.org.id, employer.owner.id, (tx) => tx.interviewSession.count({ where: { candidateUserId: student.id } }));
    expect(employerSees).toBe(1); // only the employer-assigned interview
    // Another user cannot read the practice session.
    const other = await makeUser();
    await expect(getPractice(other.id, p.id)).rejects.toThrow(/not found/);
  });

  it("13. student sees only approved feedback — never notes, assessments or drafts", async () => {
    await addNote(employer.ctx, applicationId, "PRIVATE: strong maths, check references");
    const d = await draftDisclosure(employer.ctx, applicationId, "Thank you — your project example was clear and well structured.");
    let mine = await getMyApplication(student.id, applicationId);
    expect(mine.feedback).toEqual([]);
    await setDisclosureStatus(employer.ctx, d.id, "approve", meta);
    mine = await getMyApplication(student.id, applicationId);
    expect(mine.feedback.map((f) => f.body)).toEqual(["Thank you — your project example was clear and well structured."]);
    const json = JSON.stringify(mine);
    expect(json).not.toMatch(/PRIVATE: strong maths/);
    expect(json).not.toMatch(/rating|evidence|assessment|R[1-5]"/i);
    expect(mine.interviews[0].status).toBe("COMPLETED");
    // Another student cannot open this application.
    const other = await makeUser();
    await expect(getMyApplication(other.id, applicationId)).rejects.toThrow(/not found/);
  });

  it("14. university administrator manages an authorised cohort with consent-gated visibility", async () => {
    const prog = await saveProgramme(uni.ctx, null, { name: "Placement 2027", eligibility: { graduationYears: [2027], degrees: [] }, isActive: true }, meta);
    const cohort = await createCohort(uni.ctx, { name: `DS 2027 ${uid()}`, programmeId: prog.id, graduationYear: 2027 }, meta);
    const report = await inviteStudents(uni.ctx, cohort.id, [{ email: student.email, studentNumber: "S1" }, { email: `pending-${uid()}@uni.test`, studentNumber: null }], meta);
    expect(report.invited).toBe(2);
    let members = await cohortMembers(uni.ctx, cohort.id);
    expect(members.every((m) => !m.consented)).toBe(true);
    expect(members.find((m) => m.email === student.email)).not.toHaveProperty("name");
    const invites = await listCohortInvites(student.id);
    const mine = invites.find((i) => i.cohort === cohort.name)!;
    await respondCohortInvite(student.id, mine.id, true, meta);
    members = await cohortMembers(uni.ctx, cohort.id);
    const m = members.find((x) => x.email === student.email)!;
    expect(m.consented).toBe(true);
    expect((m as { applications: Record<string, number> }).applications.SUBMITTED ?? (m as { applications: Record<string, number> }).applications.INTERVIEWING).toBeGreaterThan(0);
    const json = JSON.stringify(members);
    expect(json).not.toMatch(/assessment|transcript|rating|note/i);
    expect(json).not.toContain(employer.org.name); // no employer identities, aggregate counts only
    const analytics = await cohortAnalytics(uni.ctx);
    expect(analytics.find((a) => a.cohortId === cohort.id)?.joined).toBe(1);
    // University cannot read the employer's application data through its own tenant.
    const leaked = await withOrg(uni.org.id, uni.owner.id, (tx) => tx.application.count({ where: { id: applicationId } }));
    expect(leaked).toBe(0);
  });

  it("student withdraws; pending interview is cancelled and its credit released", async () => {
    const j = await createJob(employer.ctx, { title: `Another ${uid()}`, description: "Another role description long enough.", requiredQualifications: [], requiredSkills: [], preferredSkills: [], remotePolicy: "REMOTE", employmentType: "FULL_TIME", openings: 1, visibility: "PUBLIC", campusHiring: false, eligibleGraduationYears: [], eligibleDegrees: [], eligibleProgrammeIds: [], screeningQuestions: [], aiDraftUsed: false }, meta);
    await changeJobStatus(employer.ctx, j.id, "publish", {}, meta);
    const app = await applyToJob(student.id, { jobId: j.id, consentToShare: true, screeningAnswers: [], saveAsDraft: false }, meta);
    await inviteToInterview(employer.ctx, app.id, { templateId, expiresInDays: 3 }, meta);
    const { balance } = await import("@/server/billing/credits");
    const before = await withOrg(employer.org.id, null, (tx) => balance(tx, { organisationId: employer.org.id }));
    await withdrawApplication(student.id, app.id, "Accepted another offer", meta);
    const after = await withOrg(employer.org.id, null, (tx) => balance(tx, { organisationId: employer.org.id }));
    expect(after.reserved).toBe(before.reserved - 1);
    expect(after.available).toBe(before.available + 1);
    expect((await getMyApplication(student.id, app.id)).status).toBe("WITHDRAWN");
  });
});
