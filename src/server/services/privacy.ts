import { z } from "zod";
import { prisma } from "../db/client";
import { withOrg, withPurge, withSystem, withUser, type Tx } from "../db/tenant";
import { badRequest, notFound } from "../errors";
import { audit } from "../audit";
import type { OrgContext } from "../auth/context";
import { storeFile, deleteStoredFile } from "./files";
import { enqueue } from "../queue";
import { sendEmail } from "./notifications";
import { env } from "../env";
import { revokeAllSessions } from "../auth/session";
import { DEFAULT_RETENTION } from "./defaults";
import { logger } from "../logger";
import type { RequestMeta } from "../http/route";

const DSR_DUE_DAYS = 30;

export const dsrSchema = z.object({ type: z.enum(["EXPORT", "DELETION", "CORRECTION"]), details: z.string().trim().max(3000).optional() });

export async function createDataRequest(userId: string, input: z.infer<typeof dsrSchema>, meta: RequestMeta) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const open = await prisma.dataSubjectRequest.findFirst({ where: { userId, type: input.type, status: { in: ["RECEIVED", "IN_PROGRESS"] }, organisationId: null } });
  if (open) return open;
  const req = await prisma.dataSubjectRequest.create({ data: { userId, email: user.email, type: input.type, details: input.details, dueAt: new Date(Date.now() + DSR_DUE_DAYS * 86400_000) } });
  await audit({ actorUserId: userId, action: `privacy.${input.type.toLowerCase()}_requested`, targetType: "DataSubjectRequest", targetId: req.id, ip: meta.ip });
  if (input.type === "EXPORT") await enqueue("dsr.export", { requestId: req.id });
  if (input.type === "DELETION") await enqueue("dsr.delete", { requestId: req.id });
  return req;
}

export async function listMyDataRequests(userId: string) {
  return prisma.dataSubjectRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

/** Everything the platform holds about the person in their own right (personal account data). */
export async function buildPersonalExport(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      profile: true,
      studentProfile: { include: { education: true, skills: true, projects: true, certifications: true, experiences: true, preference: true, accommodations: true } },
      consents: true,
      savedJobs: true,
      notifications: true,
      notificationPrefs: true,
      practiceSessions: { include: { answers: true, feedback: true } },
      dataRequests: true,
    },
  });
  const resumes = await prisma.resumeVersion.findMany({ where: { userId }, select: { id: true, label: true, parsed: true, extractedText: true, createdAt: true } });
  const applications = await withUser(userId, (tx) => tx.application.findMany({ where: { candidateUserId: userId }, select: { id: true, organisationId: true, jobId: true, status: true, submittedAt: true, coverLetter: true, screeningAnswers: true, sharedProfile: true, withdrawnAt: true } }));
  const { passwordHash: _p, mfaSecret: _m, ...safeUser } = user;
  void _p;
  void _m;
  return {
    generatedAt: new Date().toISOString(),
    notice: "This export contains personal data held in your own account. Employers you applied to are independent controllers of their recruitment records; request their records from them (we forward requests on your behalf).",
    account: safeUser,
    resumes,
    applications,
  };
}

export async function processExport(requestId: string) {
  const req = await prisma.dataSubjectRequest.findUnique({ where: { id: requestId } });
  if (!req || req.status === "COMPLETED" || !req.userId) return;
  await prisma.dataSubjectRequest.update({ where: { id: req.id }, data: { status: "IN_PROGRESS" } });
  const data = await buildPersonalExport(req.userId);
  const file = await storeFile({ buffer: Buffer.from(JSON.stringify(data, null, 2)), fileName: `data-export-${new Date().toISOString().slice(0, 10)}.json`, purpose: "EXPORT", allowedTypes: ["application/json"], ownerUserId: req.userId });
  await prisma.dataSubjectRequest.update({ where: { id: req.id }, data: { status: "COMPLETED", completedAt: new Date(), resultFileId: file.id } });
  await sendEmail("dataExportReady", { url: `${env().APP_URL}/api/v1/files/${file.id}` }, { to: req.email, userId: req.userId, idempotencyKey: `dsr-export:${req.id}` });
}

/**
 * Account deletion. Personal account data is erased; the consent log is kept
 * pseudonymised (legal evidence). For each employer holding a recruitment
 * record, a deletion request is opened for that employer (the controller) to
 * action — the platform does not silently destroy an employer's records, but
 * the candidate's account link is removed immediately.
 */
export async function processDeletion(requestId: string) {
  const req = await prisma.dataSubjectRequest.findUnique({ where: { id: requestId } });
  if (!req || req.status === "COMPLETED" || !req.userId) return;
  const userId = req.userId;
  const job = await prisma.deletionJob.upsert({ where: { requestId: req.id }, create: { requestId: req.id, scope: "USER_ACCOUNT", targetId: userId, status: "RUNNING", startedAt: new Date() }, update: { status: "RUNNING", startedAt: new Date() } });
  try {
    const resumes = await prisma.resumeVersion.findMany({ where: { userId } });
    for (const r of resumes) await deleteStoredFile(r.fileId);
    const personalFiles = await prisma.storedFile.findMany({ where: { ownerUserId: userId, organisationId: null, deletedAt: null } });
    for (const f of personalFiles) await deleteStoredFile(f.id);
    const candidates = await withSystem("dsr deletion candidates", (tx) => tx.candidate.findMany({ where: { userId }, select: { id: true, organisationId: true } }));
    const anonEmail = `deleted+${userId}@deleted.invalid`;
    await prisma.$transaction(async (tx) => {
      await tx.resumeVersion.deleteMany({ where: { userId } });
      await tx.practiceInterview.deleteMany({ where: { userId } });
      await tx.studentProfile.deleteMany({ where: { userId } });
      await tx.savedJob.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.accommodationRequest.deleteMany({ where: { userId, organisationId: null } });
      await tx.organisationMembership.updateMany({ where: { userId }, data: { status: "REMOVED" } });
      await tx.userProfile.deleteMany({ where: { userId } });
      await tx.authToken.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: { email: anonEmail, passwordHash: null, mfaSecret: null, mfaEnabledAt: null, status: "DELETED" } });
    });
    await revokeAllSessions(userId, "account_deleted");
    for (const c of candidates) {
      await withSystem("dsr unlink candidate", async (tx) => {
        await tx.candidate.update({ where: { id: c.id }, data: { userId: null } });
        await tx.application.updateMany({ where: { candidateId: c.id }, data: { candidateUserId: null } });
        await tx.interviewSession.updateMany({ where: { application: { candidateId: c.id } }, data: { candidateUserId: null } });
        await tx.cohortMembership.updateMany({ where: { userId }, data: { userId: null, status: "REMOVED" } });
      });
      await prisma.dataSubjectRequest.create({ data: { email: req.email, organisationId: c.organisationId, type: "DELETION", details: `Forwarded from platform account deletion ${req.id}. Candidate record: ${c.id}`, dueAt: req.dueAt } });
    }
    await prisma.dataSubjectRequest.update({ where: { id: req.id }, data: { status: "COMPLETED", completedAt: new Date(), email: anonEmail } });
    await prisma.deletionJob.update({ where: { id: job.id }, data: { status: "COMPLETED", finishedAt: new Date(), summary: { resumes: resumes.length, files: personalFiles.length, employersNotified: candidates.length } } });
    await audit({ actorType: "SYSTEM", action: "privacy.account_deleted", targetType: "User", targetId: userId, metadata: { employersNotified: candidates.length } });
  } catch (err) {
    await prisma.deletionJob.update({ where: { id: job.id }, data: { status: "FAILED", error: (err as Error).message.slice(0, 1000) } });
    throw err;
  }
}

// ───────────────────────── Employer-side privacy ─────────────────────────

export async function listOrgDataRequests(ctx: OrgContext) {
  ctx.assert("retention.manage");
  return prisma.dataSubjectRequest.findMany({ where: { organisationId: ctx.org.id }, orderBy: { createdAt: "desc" } });
}

/** Erase a candidate and everything derived (applications, interviews, audio, transcripts, assessments, documents). */
export async function eraseCandidate(ctx: OrgContext, candidateId: string, reason: string, meta: RequestMeta) {
  ctx.assert("retention.manage");
  if (!reason?.trim()) throw badRequest("A reason is required");
  const files = await withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const c = await tx.candidate.findFirst({ where: { id: candidateId, organisationId: ctx.org.id } });
    if (!c) throw notFound("Candidate");
    const docs = await tx.candidateDocument.findMany({ where: { candidateId } });
    const audio = await tx.audioAsset.findMany({ where: { session: { application: { candidateId } } } });
    return [...docs.map((d) => d.fileId), ...audio.map((a) => a.fileId)];
  });
  for (const f of files) await deleteStoredFile(f);
  await withPurge(`erase candidate ${candidateId}`, (tx) => tx.candidate.delete({ where: { id: candidateId } }));
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "privacy.candidate_erased", targetType: "Candidate", targetId: candidateId, reason, ip: meta.ip, metadata: { files: files.length } });
  return { erased: true, files: files.length };
}

export async function resolveOrgDataRequest(ctx: OrgContext, id: string, status: "COMPLETED" | "REJECTED", note: string, meta: RequestMeta) {
  ctx.assert("retention.manage");
  const r = await prisma.dataSubjectRequest.findFirst({ where: { id, organisationId: ctx.org.id } });
  if (!r) throw notFound("Request");
  await prisma.dataSubjectRequest.update({ where: { id }, data: { status, handledById: ctx.userId, completedAt: new Date(), details: `${r.details ?? ""}\n[${status}] ${note}`.slice(0, 3000) } });
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "privacy.request_resolved", targetType: "DataSubjectRequest", targetId: id, reason: note, ip: meta.ip, metadata: { status } });
}

export const retentionSchema = z.object({
  policies: z.array(z.object({ dataCategory: z.enum(["AUDIO", "TRANSCRIPT", "ASSESSMENT", "APPLICATION", "RESUME", "AUDIT"]), retainDays: z.number().int().min(30).max(3650) })).max(6),
});

const MAX_DAYS: Record<string, number> = { AUDIO: 730, TRANSCRIPT: 1095, ASSESSMENT: 1095, APPLICATION: 1825, RESUME: 1825, AUDIT: 3650 };
const MIN_DAYS: Record<string, number> = { AUDIT: 365 };

export async function getRetention(orgId: string) {
  const rows = await prisma.retentionPolicy.findMany({ where: { organisationId: orgId } });
  return DEFAULT_RETENTION.map((d) => ({ dataCategory: d.dataCategory, retainDays: rows.find((r) => r.dataCategory === d.dataCategory)?.retainDays ?? d.retainDays, max: MAX_DAYS[d.dataCategory], min: MIN_DAYS[d.dataCategory] ?? 30 }));
}

export async function setRetention(ctx: OrgContext, input: z.infer<typeof retentionSchema>, meta: RequestMeta) {
  ctx.assert("retention.manage");
  for (const p of input.policies) {
    if (p.retainDays > MAX_DAYS[p.dataCategory]) throw badRequest(`${p.dataCategory} retention cannot exceed ${MAX_DAYS[p.dataCategory]} days on this platform`);
    if (p.retainDays < (MIN_DAYS[p.dataCategory] ?? 30)) throw badRequest(`${p.dataCategory} retention must be at least ${MIN_DAYS[p.dataCategory] ?? 30} days`);
    await prisma.retentionPolicy.upsert({ where: { organisationId_dataCategory: { organisationId: ctx.org.id, dataCategory: p.dataCategory } }, create: { organisationId: ctx.org.id, ...p, updatedById: ctx.userId }, update: { retainDays: p.retainDays, updatedById: ctx.userId } });
  }
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "retention.updated", ip: meta.ip, metadata: { policies: input.policies } });
  return getRetention(ctx.org.id);
}

/**
 * Scheduled enforcement of retention policies across all organisations.
 * Deletes object-storage files first, then database rows (append-only tables via purge context).
 */
export async function retentionSweep(now = new Date()) {
  const orgs = await prisma.organisation.findMany({ select: { id: true } });
  const summary: Record<string, number> = { audio: 0, transcripts: 0, assessments: 0, candidates: 0, resumes: 0, audit: 0, exports: 0 };
  for (const org of orgs) {
    const policies = Object.fromEntries((await getRetention(org.id)).map((p) => [p.dataCategory, p.retainDays]));
    const cutoff = (cat: string) => new Date(now.getTime() - policies[cat] * 86400_000);
    try {
      const audio = await withOrg(org.id, null, (tx) => tx.audioAsset.findMany({ where: { organisationId: org.id, createdAt: { lt: cutoff("AUDIO") } } }));
      for (const a of audio) await deleteStoredFile(a.fileId);
      if (audio.length) await withOrg(org.id, null, (tx) => tx.audioAsset.deleteMany({ where: { id: { in: audio.map((a) => a.id) } } }));
      summary.audio += audio.length;

      await withOrg(org.id, null, async (tx: Tx) => {
        const old = await tx.interviewSession.findMany({ where: { organisationId: org.id, completedAt: { lt: cutoff("TRANSCRIPT") } }, select: { id: true } });
        const ids = old.map((s) => s.id);
        if (ids.length) {
          const r = await tx.transcriptSegment.deleteMany({ where: { sessionId: { in: ids } } });
          await tx.answer.updateMany({ where: { sessionId: { in: ids } }, data: { transcript: null, textResponse: null } });
          summary.transcripts += r.count;
        }
        const a = await tx.assessment.deleteMany({ where: { organisationId: org.id, assessedAt: { lt: cutoff("ASSESSMENT") } } });
        summary.assessments += a.count;
      });

      const docs = await withOrg(org.id, null, (tx) => tx.candidateDocument.findMany({ where: { organisationId: org.id, createdAt: { lt: cutoff("RESUME") } } }));
      for (const d of docs) await deleteStoredFile(d.fileId);
      if (docs.length) await withOrg(org.id, null, (tx) => tx.candidateDocument.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } }));
      summary.resumes += docs.length;

      // Candidates whose every application concluded before the cutoff.
      const stale = await withOrg(org.id, null, (tx) =>
        tx.candidate.findMany({ where: { organisationId: org.id, applications: { every: { updatedAt: { lt: cutoff("APPLICATION") }, status: { in: ["HIRED", "REJECTED", "WITHDRAWN"] } } }, createdAt: { lt: cutoff("APPLICATION") } }, select: { id: true } }),
      );
      for (const c of stale) await withPurge("retention candidate", (tx) => tx.candidate.delete({ where: { id: c.id } }));
      summary.candidates += stale.length;

      const purged = await withPurge("retention audit", (tx) => tx.auditEvent.deleteMany({ where: { organisationId: org.id, createdAt: { lt: cutoff("AUDIT") } } }));
      summary.audit += purged.count;
    } catch (err) {
      logger.error({ err, org: org.id }, "retention sweep failed for organisation");
    }
  }
  // Generated exports expire after 7 days.
  const exports = await prisma.storedFile.findMany({ where: { purpose: "EXPORT", deletedAt: null, createdAt: { lt: new Date(now.getTime() - 7 * 86400_000) } } });
  for (const f of exports) await deleteStoredFile(f.id);
  summary.exports = exports.length;
  await prisma.deletionJob.create({ data: { scope: "RETENTION_SWEEP", targetId: "all", status: "COMPLETED", startedAt: now, finishedAt: new Date(), summary } });
  return summary;
}
