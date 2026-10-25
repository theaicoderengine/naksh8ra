import { z } from "zod";
import type { Prisma, StageKind } from "@prisma/client";
import { prisma } from "../db/client";
import { withOrg, withUser, withSystem, type Tx } from "../db/tenant";
import { AppError, badRequest, forbidden, invalidState, notFound, conflict } from "../errors";
import { audit } from "../audit";
import type { OrgContext } from "../auth/context";
import { checkStageMove, statusForStageKind, canCandidateWithdraw, jobAcceptsApplications, isTerminalApplication } from "../domain/state-machines";
import { copyFileToOrg } from "./files";
import { sendEmail, notify } from "./notifications";
import { env } from "../env";
import { eligibilityFor, studentEligibilityProfile } from "./jobs";
import type { RequestMeta } from "../http/route";

// ───────────────────────── scope helpers ─────────────────────────

export async function assignedJobIds(ctx: OrgContext, tx: Tx): Promise<string[] | null> {
  if (ctx.can("candidates.view_all")) return null; // unrestricted
  if (!ctx.can("candidates.view_assigned")) throw forbidden();
  return (await tx.jobAssignment.findMany({ where: { userId: ctx.userId, organisationId: ctx.org.id }, select: { jobId: true } })).map((a) => a.jobId);
}

export async function loadApplicationScoped(ctx: OrgContext, tx: Tx, id: string) {
  const scope = await assignedJobIds(ctx, tx);
  const app = await tx.application.findFirst({ where: { id, organisationId: ctx.org.id, ...(scope ? { jobId: { in: scope } } : {}) } });
  if (!app) throw notFound("Application");
  return app;
}

// ───────────────────────── stages ─────────────────────────

export async function listStages(ctx: OrgContext) {
  return withOrg(ctx.org.id, ctx.userId, (tx) => tx.applicationStage.findMany({ where: { organisationId: ctx.org.id }, orderBy: { position: "asc" } }));
}

export const stageSchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(["NEW", "REVIEW", "SCREENING", "AI_INTERVIEW_INVITED", "AI_INTERVIEW_COMPLETED", "HUMAN_INTERVIEW", "FINAL_REVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"]),
  position: z.number().int().min(0).max(100).optional(),
});

export async function createStage(ctx: OrgContext, input: z.infer<typeof stageSchema>) {
  ctx.assert("interviews.configure");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const count = await tx.applicationStage.count({ where: { organisationId: ctx.org.id } });
    if (count >= 30) throw badRequest("Maximum of 30 stages");
    const key = `${input.kind.toLowerCase()}_${Date.now().toString(36)}`;
    return tx.applicationStage.create({
      data: { organisationId: ctx.org.id, key, name: input.name, kind: input.kind, position: input.position ?? count, isTerminal: ["HIRED", "REJECTED", "WITHDRAWN"].includes(input.kind) },
    });
  });
}

export async function updateStage(ctx: OrgContext, id: string, input: { name?: string; position?: number }) {
  ctx.assert("interviews.configure");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const s = await tx.applicationStage.findFirst({ where: { id, organisationId: ctx.org.id } });
    if (!s) throw notFound("Stage");
    return tx.applicationStage.update({ where: { id }, data: { name: input.name?.trim(), position: input.position } });
  });
}

export async function deleteStage(ctx: OrgContext, id: string) {
  ctx.assert("interviews.configure");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const s = await tx.applicationStage.findFirst({ where: { id, organisationId: ctx.org.id } });
    if (!s) throw notFound("Stage");
    const sameKind = await tx.applicationStage.count({ where: { organisationId: ctx.org.id, kind: s.kind } });
    if (sameKind <= 1) throw conflict("Each stage type must keep at least one stage");
    const used = await tx.application.count({ where: { stageId: id, organisationId: ctx.org.id } });
    if (used) throw conflict("Move applications out of this stage before deleting it");
    await tx.applicationStage.delete({ where: { id } });
  });
}

async function stageOfKind(tx: Tx, orgId: string, kind: StageKind) {
  const s = await tx.applicationStage.findFirst({ where: { organisationId: orgId, kind }, orderBy: { position: "asc" } });
  if (!s) throw new AppError("INTERNAL", `Organisation has no ${kind} stage`);
  return s;
}

// ───────────────────────── HR: list / detail ─────────────────────────

export const applicationListQuery = z.object({
  jobId: z.string().optional(),
  stageId: z.string().optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "INTERVIEWING", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"]).optional(),
  q: z.string().max(100).optional(),
  assignedToMe: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listApplications(ctx: OrgContext, q: z.infer<typeof applicationListQuery>) {
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const scope = await assignedJobIds(ctx, tx);
    const where: Prisma.ApplicationWhereInput = {
      organisationId: ctx.org.id,
      status: q.status ? q.status : { not: "DRAFT" },
      ...(scope ? { jobId: { in: q.jobId ? scope.filter((j) => j === q.jobId) : scope } } : q.jobId ? { jobId: q.jobId } : {}),
      ...(q.stageId ? { stageId: q.stageId } : {}),
      ...(q.assignedToMe === "true" ? { assignedToId: ctx.userId } : {}),
      ...(q.q
        ? { candidate: { OR: [{ firstName: { contains: q.q, mode: "insensitive" } }, { lastName: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }] } }
        : {}),
    };
    const [items, total] = await Promise.all([
      tx.application.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true, email: true, source: true } },
          job: { select: { id: true, title: true } },
          stage: true,
          sessions: { select: { id: true, status: true, providerMode: true, assessment: { select: { status: true, evidenceCoverage: true } } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      tx.application.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
}

export async function getApplication(ctx: OrgContext, id: string) {
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    await loadApplicationScoped(ctx, tx, id);
    const app = await tx.application.findFirstOrThrow({
      where: { id, organisationId: ctx.org.id },
      include: {
        candidate: { include: { documents: true } },
        job: { select: { id: true, title: true, interviewTemplateId: true, screeningQuestions: true } },
        stage: true,
        history: { orderBy: { createdAt: "asc" } },
        notes: ctx.can("notes.write") ? { orderBy: { createdAt: "desc" } } : false,
        invitations: { orderBy: { createdAt: "desc" }, include: { template: { select: { name: true, mode: true } } } },
        sessions: {
          orderBy: { createdAt: "desc" },
          include: { assessment: { include: { results: { include: { evidence: true } }, reviews: { orderBy: { createdAt: "desc" } } } } },
        },
        feedback: { orderBy: { createdAt: "desc" } },
        disclosures: { orderBy: { createdAt: "desc" } },
      },
    });
    const files = await prisma.storedFile.findMany({ where: { id: { in: app.candidate.documents.map((d) => d.fileId) }, organisationId: ctx.org.id }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true, scanStatus: true } });
    const userIds = [...new Set([...app.history.map((h) => h.actorUserId), ...(app.notes || []).map((n) => n.authorId), ...app.feedback.map((f) => f.reviewerId)].filter(Boolean) as string[])];
    const people = await prisma.userProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, firstName: true, lastName: true } });
    return { ...app, files, people: Object.fromEntries(people.map((p) => [p.userId, `${p.firstName} ${p.lastName}`])) };
  });
}

// ───────────────────────── HR: stage moves ─────────────────────────

export const moveSchema = z.object({
  stageId: z.string(),
  reason: z.string().trim().max(1000).optional(),
  notifyCandidate: z.boolean().default(false),
});

async function applyMove(ctx: OrgContext, tx: Tx, appId: string, input: z.infer<typeof moveSchema>, meta: RequestMeta) {
  const app = await loadApplicationScoped(ctx, tx, appId);
  const stage = await tx.applicationStage.findFirst({ where: { id: input.stageId, organisationId: ctx.org.id } });
  if (!stage) throw notFound("Stage");
  if (app.stageId === stage.id) return { app, changed: false };
  const check = checkStageMove(app, stage.kind, { canDecide: ctx.can("applications.decide"), reason: input.reason });
  if (!check.ok) throw invalidState(check.reason);
  if (!ctx.can("applications.move")) throw forbidden();
  const toStatus = statusForStageKind(stage.kind);
  const decided = toStatus === "HIRED" || toStatus === "REJECTED";
  const updated = await tx.application.update({
    where: { id: app.id },
    data: { stageId: stage.id, status: toStatus, ...(decided ? { decidedAt: new Date(), decisionReason: input.reason } : {}) },
  });
  await tx.applicationStageHistory.create({
    data: {
      organisationId: ctx.org.id,
      applicationId: app.id,
      fromStageId: app.stageId,
      toStageId: stage.id,
      fromStatus: app.status,
      toStatus,
      actorUserId: ctx.userId,
      reason: input.reason,
      visibleToCandidate: input.notifyCandidate && toStatus !== app.status,
    },
  });
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: decided ? "application.decided" : "application.moved", targetType: "Application", targetId: app.id, ip: meta.ip, metadata: { to: stage.key, status: toStatus } }, tx);
  return { app: updated, changed: true, notify: input.notifyCandidate && toStatus !== app.status, toStatus };
}

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  IN_REVIEW: "In review",
  INTERVIEWING: "Interviewing",
  OFFER: "Offer stage",
  HIRED: "Successful",
  REJECTED: "Not progressing",
};

async function notifyStatus(orgId: string, appId: string, status: string) {
  const app = await withOrg(orgId, null, (tx) => tx.application.findFirst({ where: { id: appId }, include: { candidate: true, job: { select: { title: true } } } }));
  if (!app) return;
  const url = app.candidateUserId ? `${env().APP_URL}/student/applications/${app.id}` : `${env().APP_URL}/login`;
  await sendEmail("applicationStatus", { name: app.candidate.firstName, job: app.job.title, status: STATUS_LABEL[status] ?? status, url }, { to: app.candidate.email, userId: app.candidateUserId ?? undefined, organisationId: orgId, topic: "application_updates", idempotencyKey: `status:${appId}:${status}:${Date.now()}` });
  if (app.candidateUserId) await notify(app.candidateUserId, { type: "application_updates", title: `Update: ${app.job.title}`, body: `Status: ${STATUS_LABEL[status] ?? status}`, link: `/student/applications/${app.id}` });
}

export async function moveApplication(ctx: OrgContext, appId: string, input: z.infer<typeof moveSchema>, meta: RequestMeta) {
  const res = await withOrg(ctx.org.id, ctx.userId, (tx) => applyMove(ctx, tx, appId, input, meta));
  if (res.notify && res.toStatus) await notifyStatus(ctx.org.id, appId, res.toStatus);
  return res.app;
}

export const bulkMoveSchema = moveSchema.extend({ applicationIds: z.array(z.string()).min(1).max(200) });

export async function bulkMove(ctx: OrgContext, input: z.infer<typeof bulkMoveSchema>, meta: RequestMeta) {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of input.applicationIds) {
    try {
      const r = await withOrg(ctx.org.id, ctx.userId, (tx) => applyMove(ctx, tx, id, input, meta));
      if (r.notify && r.toStatus) await notifyStatus(ctx.org.id, id, r.toStatus);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof AppError ? e.message : "Failed" });
    }
  }
  return { results };
}

export async function assignApplication(ctx: OrgContext, appId: string, userId: string | null) {
  ctx.assert("applications.move");
  if (userId) {
    const m = await prisma.organisationMembership.findFirst({ where: { organisationId: ctx.org.id, userId, status: "ACTIVE" } });
    if (!m) throw notFound("Member");
  }
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    await loadApplicationScoped(ctx, tx, appId);
    return tx.application.update({ where: { id: appId }, data: { assignedToId: userId } });
  });
}

export async function addNote(ctx: OrgContext, appId: string, body: string) {
  ctx.assert("notes.write");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const app = await loadApplicationScoped(ctx, tx, appId);
    return tx.candidateNote.create({ data: { organisationId: ctx.org.id, candidateId: app.candidateId, applicationId: app.id, authorId: ctx.userId, body: body.trim() } });
  });
}

// ───────────────────────── HR: add candidate manually ─────────────────────────

export const manualCandidateSchema = z.object({
  jobId: z.string(),
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(40).optional(),
  location: z.string().trim().max(120).optional(),
  headline: z.string().trim().max(200).optional(),
  source: z.enum(["DIRECT", "IMPORT", "REFERRAL", "AGENCY"]).default("DIRECT"),
});

export async function addCandidateToJob(ctx: OrgContext, input: z.infer<typeof manualCandidateSchema>, meta: RequestMeta) {
  ctx.assert("candidates.manage");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const scope = await assignedJobIds(ctx, tx);
    if (scope && !scope.includes(input.jobId)) throw notFound("Job");
    const job = await tx.job.findFirst({ where: { id: input.jobId, organisationId: ctx.org.id } });
    if (!job) throw notFound("Job");
    // Link to an existing platform account only if the person has one — we do not create accounts for them.
    const user = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
    const candidate = await tx.candidate.upsert({
      where: { organisationId_email: { organisationId: ctx.org.id, email: input.email } },
      create: { organisationId: ctx.org.id, email: input.email, firstName: input.firstName, lastName: input.lastName, phone: input.phone, location: input.location, headline: input.headline, source: input.source, userId: user?.id },
      update: {},
    });
    const existing = await tx.application.findUnique({ where: { jobId_candidateId: { jobId: job.id, candidateId: candidate.id } } });
    if (existing) throw conflict("This candidate already has an application for this vacancy");
    const stage = await stageOfKind(tx, ctx.org.id, "NEW");
    const app = await tx.application.create({
      data: { organisationId: ctx.org.id, jobId: job.id, candidateId: candidate.id, candidateUserId: candidate.userId, stageId: stage.id, status: "SUBMITTED", submittedAt: new Date(), source: input.source },
    });
    await tx.applicationStageHistory.create({ data: { organisationId: ctx.org.id, applicationId: app.id, toStageId: stage.id, toStatus: "SUBMITTED", actorUserId: ctx.userId, reason: "Added by recruiter" } });
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "candidate.added", targetType: "Application", targetId: app.id, ip: meta.ip }, tx);
    return app;
  });
}

// ───────────────────────── HR: export ─────────────────────────

function csvCell(v: unknown) {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportApplicationsCsv(ctx: OrgContext, q: z.infer<typeof applicationListQuery>, meta: RequestMeta) {
  ctx.assert("candidates.export");
  const { items } = await listApplications(ctx, { ...q, page: 1, pageSize: 200 });
  const rows = [["application_id", "job", "first_name", "last_name", "email", "stage", "status", "source", "submitted_at", "interview_status", "evidence_coverage"]];
  for (const a of items) {
    rows.push([a.id, a.job.title, a.candidate.firstName, a.candidate.lastName, a.candidate.email, a.stage?.name ?? "", a.status, a.source, a.submittedAt?.toISOString() ?? "", a.sessions[0]?.status ?? "", a.sessions[0]?.assessment?.evidenceCoverage?.toFixed(2) ?? ""] as string[]);
  }
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "candidates.exported", ip: meta.ip, metadata: { rows: items.length, filters: q as never } });
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// ───────────────────────── Reviewer feedback & disclosure ─────────────────────────

export const feedbackSchema = z.object({
  recommendation: z.enum(["STRONG_YES", "YES", "UNDECIDED", "NO", "STRONG_NO"]),
  summary: z.string().trim().min(10).max(5000),
  competencyNotes: z.array(z.object({ competencyId: z.string(), rating: z.enum(["INSUFFICIENT_EVIDENCE", "R1", "R2", "R3", "R4", "R5"]), note: z.string().max(2000) })).max(30).default([]),
});

export async function submitFeedback(ctx: OrgContext, appId: string, input: z.infer<typeof feedbackSchema>, meta: RequestMeta) {
  ctx.assert("feedback.write");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    await loadApplicationScoped(ctx, tx, appId);
    const fb = await tx.reviewerFeedback.upsert({
      where: { applicationId_reviewerId: { applicationId: appId, reviewerId: ctx.userId } },
      create: { organisationId: ctx.org.id, applicationId: appId, reviewerId: ctx.userId, recommendation: input.recommendation, summary: input.summary, competencyNotes: input.competencyNotes },
      update: { recommendation: input.recommendation, summary: input.summary, competencyNotes: input.competencyNotes },
    });
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "feedback.submitted", targetType: "Application", targetId: appId, ip: meta.ip }, tx);
    return fb;
  });
}

export async function draftDisclosure(ctx: OrgContext, appId: string, body: string) {
  ctx.assert("feedback.write");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    await loadApplicationScoped(ctx, tx, appId);
    return tx.candidateFeedbackDisclosure.create({ data: { organisationId: ctx.org.id, applicationId: appId, body: body.trim(), authorId: ctx.userId } });
  });
}

export async function setDisclosureStatus(ctx: OrgContext, disclosureId: string, action: "approve" | "retract", meta: RequestMeta) {
  ctx.assert("feedback.disclose");
  const res = await withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const d = await tx.candidateFeedbackDisclosure.findFirst({ where: { id: disclosureId, organisationId: ctx.org.id } });
    if (!d) throw notFound("Feedback");
    await loadApplicationScoped(ctx, tx, d.applicationId);
    if (action === "approve" && d.status !== "DRAFT") throw invalidState("Only drafts can be approved");
    if (action === "retract" && d.status !== "APPROVED") throw invalidState("Only approved feedback can be retracted");
    const updated = await tx.candidateFeedbackDisclosure.update({
      where: { id: d.id },
      data: action === "approve" ? { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } : { status: "RETRACTED" },
    });
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: `feedback.${action}d`, targetType: "CandidateFeedbackDisclosure", targetId: d.id, ip: meta.ip }, tx);
    const app = await tx.application.findFirstOrThrow({ where: { id: d.applicationId }, include: { candidate: true, job: { select: { title: true } } } });
    return { updated, app };
  });
  if (action === "approve") {
    const { app } = res;
    await sendEmail("feedbackAvailable", { name: app.candidate.firstName, job: app.job.title, url: app.candidateUserId ? `${env().APP_URL}/student/applications/${app.id}` : `${env().APP_URL}/login` }, { to: app.candidate.email, userId: app.candidateUserId ?? undefined, organisationId: ctx.org.id });
    if (app.candidateUserId) await notify(app.candidateUserId, { type: "application_updates", title: "Feedback available", body: app.job.title, link: `/student/applications/${app.id}` });
  }
  return res.updated;
}

// ───────────────────────── Applicant (student / candidate account) ─────────────────────────

export async function buildSharedProfile(userId: string, resumeVersionId?: string | null) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true, studentProfile: { include: { education: true, skills: true, projects: true, certifications: true, experiences: true } } },
  });
  const sp = user.studentProfile;
  const resume = resumeVersionId ? await prisma.resumeVersion.findFirst({ where: { id: resumeVersionId, userId } }) : null;
  if (resumeVersionId && !resume) throw notFound("Resume");
  // Exactly what the employer receives. Accessibility requests, privacy settings,
  // practice interviews and cohort membership are never included.
  return {
    name: `${user.profile?.firstName ?? ""} ${user.profile?.lastName ?? ""}`.trim(),
    email: user.email,
    phone: user.profile?.phone ?? null,
    location: [sp?.city ?? user.profile?.city, sp?.country ?? user.profile?.country].filter(Boolean).join(", ") || null,
    headline: sp?.headline ?? null,
    graduationYear: sp?.graduationYear ?? null,
    education: (sp?.education ?? []).map((e) => ({ institution: e.institution, degree: e.degree, fieldOfStudy: e.fieldOfStudy, graduationYear: e.graduationYear })),
    skills: (sp?.skills ?? []).map((s) => s.name),
    experience: (sp?.experiences ?? []).map((x) => ({ kind: x.kind, organisation: x.organisation, title: x.title, startDate: x.startDate, endDate: x.endDate })),
    projects: (sp?.projects ?? []).map((p) => ({ title: p.title, url: p.url })),
    certifications: (sp?.certifications ?? []).map((c) => ({ name: c.name, issuer: c.issuer })),
    links: (sp?.links as { label: string; url: string }[]) ?? [],
    resume: resume ? { id: resume.id, label: resume.label } : null,
  };
}

export const applySchema = z.object({
  jobId: z.string(),
  resumeVersionId: z.string().nullable().optional(),
  coverLetter: z.string().trim().max(8000).optional(),
  screeningAnswers: z.array(z.object({ id: z.string().max(40), answer: z.string().trim().max(4000) })).max(20).default([]),
  consentToShare: z.literal(true, { error: "Confirm you agree to share the previewed information" }),
  saveAsDraft: z.boolean().default(false),
});

export async function applyToJob(userId: string, input: z.infer<typeof applySchema>, meta: RequestMeta) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
  if (!user.emailVerifiedAt) throw forbidden("Verify your email before applying");
  // Resolve the job's tenant server-side from the published job (RLS public-read policy).
  const job = await withUser(userId, (tx) => tx.job.findFirst({ where: { id: input.jobId, status: "PUBLISHED", visibility: { in: ["PUBLIC", "CAMPUS"] } }, include: { organisation: { select: { status: true, name: true } } } }));
  if (!job || job.organisation.status !== "ACTIVE") throw notFound("Job");
  if (!jobAcceptsApplications(job)) throw invalidState("This vacancy is no longer accepting applications");
  const elig = eligibilityFor(job, await studentEligibilityProfile(userId));
  if (!elig.eligible) throw forbidden(`You don't meet this vacancy's eligibility criteria: ${elig.unmet.join("; ")}`);
  const questions = (job.screeningQuestions as { id: string; question: string; required: boolean }[]) ?? [];
  if (!input.saveAsDraft) {
    for (const q of questions.filter((q) => q.required)) {
      if (!input.screeningAnswers.find((a) => a.id === q.id && a.answer)) throw badRequest(`Please answer: ${q.question}`);
    }
  }
  const shared = await buildSharedProfile(userId, input.resumeVersionId);
  const isStudent = !!(await prisma.studentProfile.findUnique({ where: { userId }, select: { id: true } }));

  const resumeCopy = input.resumeVersionId && !input.saveAsDraft
    ? await copyFileToOrg((await prisma.resumeVersion.findFirstOrThrow({ where: { id: input.resumeVersionId, userId } })).fileId, job.organisationId)
    : null;

  const app = await withOrg(job.organisationId, userId, async (tx) => {
    // One candidate identity per (organisation, user): no duplicates, no duplicate charges.
    let candidate = await tx.candidate.findFirst({ where: { organisationId: job.organisationId, OR: [{ userId }, { email: user.email }] } });
    if (!candidate) {
      candidate = await tx.candidate.create({
        data: { organisationId: job.organisationId, userId, email: user.email, firstName: user.profile?.firstName ?? "", lastName: user.profile?.lastName ?? "", phone: user.profile?.phone, location: shared.location, headline: shared.headline, source: isStudent ? "STUDENT_PORTAL" : "DIRECT" },
      });
    } else if (!candidate.userId) {
      candidate = await tx.candidate.update({ where: { id: candidate.id }, data: { userId } });
      await tx.application.updateMany({ where: { candidateId: candidate.id }, data: { candidateUserId: userId } });
    }
    const existing = await tx.application.findUnique({ where: { jobId_candidateId: { jobId: job.id, candidateId: candidate.id } } });
    if (existing && existing.status !== "DRAFT") throw conflict("You have already applied for this vacancy");
    const stage = await stageOfKind(tx, job.organisationId, "NEW");
    const status = input.saveAsDraft ? "DRAFT" : "SUBMITTED";
    const data = {
      coverLetter: input.coverLetter,
      screeningAnswers: input.screeningAnswers,
      sharedProfile: shared as Prisma.InputJsonValue,
      resumeVersionId: input.resumeVersionId ?? null,
      status: status as "DRAFT" | "SUBMITTED",
      stageId: input.saveAsDraft ? null : stage.id,
      submittedAt: input.saveAsDraft ? null : new Date(),
      source: isStudent ? "STUDENT_PORTAL" : "DIRECT",
    };
    const app = existing
      ? await tx.application.update({ where: { id: existing.id }, data })
      : await tx.application.create({ data: { ...data, organisationId: job.organisationId, jobId: job.id, candidateId: candidate.id, candidateUserId: userId } });
    if (!input.saveAsDraft) {
      if (resumeCopy) await tx.candidateDocument.create({ data: { organisationId: job.organisationId, candidateId: candidate.id, fileId: resumeCopy.id, kind: "RESUME" } });
      await tx.applicationStageHistory.create({ data: { organisationId: job.organisationId, applicationId: app.id, toStageId: stage.id, fromStatus: existing?.status, toStatus: "SUBMITTED", actorUserId: userId, reason: "Application submitted", visibleToCandidate: true } });
      await audit({ organisationId: job.organisationId, actorUserId: userId, actorType: "CANDIDATE", action: "application.submitted", targetType: "Application", targetId: app.id, ip: meta.ip }, tx);
    }
    return app;
  });
  await prisma.consentRecord.create({ data: { userId, organisationId: job.organisationId, type: "PRIVACY_NOTICE", granted: true, noticeVersion: `application-share:${job.id}`, ipAddress: meta.ip, userAgent: meta.userAgent } });
  if (!input.saveAsDraft) {
    await sendEmail("applicationConfirmation", { name: user.profile?.firstName ?? "there", job: job.title, org: job.organisation.name, url: `${env().APP_URL}/student/applications/${app.id}` }, { to: user.email, userId, organisationId: job.organisationId, idempotencyKey: `apply:${app.id}` });
    await notify(userId, { type: "application_updates", title: "Application submitted", body: `${job.title} at ${job.organisation.name}`, link: `/student/applications/${app.id}` });
  }
  return app;
}

export async function listMyApplications(userId: string) {
  return withUser(userId, async (tx) => {
    const apps = await tx.application.findMany({
      where: { candidateUserId: userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, status: true, submittedAt: true, updatedAt: true, createdAt: true, jobId: true, organisationId: true },
    });
    const jobs = await withSystem("applicant job titles", (s) =>
      s.job.findMany({ where: { id: { in: apps.map((a) => a.jobId) } }, select: { id: true, title: true, location: true, remotePolicy: true, organisation: { select: { name: true } } } }),
    );
    const byId = new Map(jobs.map((j) => [j.id, j]));
    const sessions = await tx.interviewSession.findMany({ where: { candidateUserId: userId }, select: { applicationId: true, status: true, invitationId: true } });
    return apps.map((a) => ({
      ...a,
      job: byId.get(a.jobId) ? { title: byId.get(a.jobId)!.title, location: byId.get(a.jobId)!.location, remotePolicy: byId.get(a.jobId)!.remotePolicy, organisation: byId.get(a.jobId)!.organisation.name } : null,
      interviews: sessions.filter((s) => s.applicationId === a.id).map((s) => ({ status: candidateFacingSessionStatus(s.status) })),
    }));
  });
}

/** Candidates see a simplified status — never assessment/review states. */
export function candidateFacingSessionStatus(s: string) {
  if (["INVITED", "READY", "CREATED"].includes(s)) return "PENDING";
  if (s === "IN_PROGRESS" || s === "INTERRUPTED") return "IN_PROGRESS";
  if (["PROCESSING", "ASSESSED", "REQUIRES_REVIEW", "REVIEWED", "CLOSED"].includes(s)) return "COMPLETED";
  return s; // EXPIRED | CANCELLED | FAILED
}

export async function getMyApplication(userId: string, id: string) {
  const app = await withUser(userId, (tx) =>
    tx.application.findFirst({
      where: { id, candidateUserId: userId },
      select: { id: true, status: true, submittedAt: true, createdAt: true, updatedAt: true, withdrawnAt: true, organisationId: true, jobId: true, coverLetter: true, screeningAnswers: true, sharedProfile: true },
    }),
  );
  if (!app) throw notFound("Application");
  // Ownership verified above; now read candidate-visible parts in the employer's tenant
  // with explicit filters (visible history, APPROVED disclosures, own invitations only).
  return withOrg(app.organisationId, userId, async (tx) => {
    const [history, disclosures, invitations, job] = await Promise.all([
      tx.applicationStageHistory.findMany({ where: { applicationId: app.id, visibleToCandidate: true }, orderBy: { createdAt: "asc" }, select: { toStatus: true, createdAt: true } }),
      tx.candidateFeedbackDisclosure.findMany({ where: { applicationId: app.id, status: "APPROVED" }, select: { id: true, body: true, approvedAt: true } }),
      tx.interviewInvitation.findMany({
        where: { applicationId: app.id, revokedAt: null },
        select: { id: true, expiresAt: true, createdAt: true, template: { select: { name: true, mode: true, durationMinutes: true } }, session: { select: { status: true } } },
      }),
      tx.job.findFirst({ where: { id: app.jobId }, select: { title: true, location: true, organisation: { select: { name: true } } } }),
    ]);
    return {
      ...app,
      job,
      history,
      feedback: disclosures,
      interviews: invitations.map((i) => ({ id: i.id, name: i.template.name, mode: i.template.mode, minutes: i.template.durationMinutes, expiresAt: i.expiresAt, status: candidateFacingSessionStatus(i.session?.status ?? "INVITED") })),
      canWithdraw: canCandidateWithdraw(app.status),
    };
  });
}

export async function withdrawApplication(userId: string, id: string, reason: string | undefined, meta: RequestMeta) {
  const app = await withUser(userId, (tx) => tx.application.findFirst({ where: { id, candidateUserId: userId } }));
  if (!app) throw notFound("Application");
  if (!canCandidateWithdraw(app.status)) throw invalidState("This application can no longer be withdrawn");
  await withOrg(app.organisationId, userId, async (tx) => {
    const stage = await stageOfKind(tx, app.organisationId, "WITHDRAWN");
    await tx.application.update({ where: { id }, data: { status: "WITHDRAWN", stageId: stage.id, withdrawnAt: new Date(), withdrawReason: reason?.slice(0, 1000) } });
    await tx.applicationStageHistory.create({ data: { organisationId: app.organisationId, applicationId: id, fromStageId: app.stageId, toStageId: stage.id, fromStatus: app.status, toStatus: "WITHDRAWN", actorUserId: userId, reason: "Withdrawn by applicant", visibleToCandidate: true } });
    // Pending interviews are cancelled; any reserved credit is released by the interview service.
    const sessions = await tx.interviewSession.findMany({ where: { applicationId: id, status: { in: ["CREATED", "INVITED", "READY", "IN_PROGRESS", "INTERRUPTED"] } } });
    await tx.interviewInvitation.updateMany({ where: { applicationId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ organisationId: app.organisationId, actorUserId: userId, actorType: "CANDIDATE", action: "application.withdrawn", targetType: "Application", targetId: id, ip: meta.ip }, tx);
    return sessions;
  }).then(async (sessions) => {
    const { cancelSession } = await import("./interviews");
    for (const s of sessions) await cancelSession(app.organisationId, s.id, "application_withdrawn", null);
  });
  return { ok: true };
}

export { isTerminalApplication };
