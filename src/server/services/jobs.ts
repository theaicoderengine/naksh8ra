import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withOrg, withUser, withSystem, type Tx } from "../db/tenant";
import { prisma } from "../db/client";
import { AppError, forbidden, invalidState, notFound } from "../errors";
import { audit } from "../audit";
import type { OrgContext } from "../auth/context";
import { canAccessJob } from "../auth/context";
import { nextJobStatus, type JobAction } from "../domain/state-machines";
import { slugify } from "@/lib/id";
import { aiJson } from "../ai/access";
import { JD_PROMPT_VERSION, JD_SYSTEM, JobDraftSchema, inputBlock } from "../ai/prompts";
import type { RequestMeta } from "../http/route";

const str = (max: number) => z.string().trim().max(max);
const list = z.array(z.string().trim().min(1).max(200)).max(50).default([]);

export const jobBaseSchema = z.object({
    title: str(160).min(2),
    departmentId: z.string().nullable().optional(),
    description: str(20000).min(20, "Add a description of at least 20 characters"),
    responsibilities: str(10000).nullable().optional(),
    requiredQualifications: list,
    requiredSkills: list,
    preferredSkills: list,
    location: str(160).nullable().optional(),
    country: z.string().trim().length(2).toUpperCase().nullable().optional(),
    remotePolicy: z.enum(["ONSITE", "HYBRID", "REMOTE"]).default("ONSITE"),
    employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "TEMPORARY", "GRADUATE_PROGRAMME"]).default("FULL_TIME"),
    experienceMin: z.number().int().min(0).max(60).nullable().optional(),
    experienceMax: z.number().int().min(0).max(60).nullable().optional(),
    salaryMin: z.number().int().min(0).nullable().optional(),
    salaryMax: z.number().int().min(0).nullable().optional(),
    salaryCurrency: z.string().length(3).toUpperCase().nullable().optional(),
    salaryPeriod: z.enum(["YEAR", "MONTH", "HOUR"]).nullable().optional(),
    openings: z.number().int().min(1).max(10000).default(1),
    applicationDeadline: z.coerce.date().nullable().optional(),
    visibility: z.enum(["PUBLIC", "CAMPUS", "INTERNAL", "INVITE_ONLY"]).default("PUBLIC"),
    campusHiring: z.boolean().default(false),
    eligibleGraduationYears: z.array(z.number().int().min(1950).max(2100)).max(20).default([]),
    eligibleDegrees: z.array(z.string().trim().max(120)).max(30).default([]),
    eligibleProgrammeIds: z.array(z.string()).max(30).default([]),
    screeningQuestions: z.array(z.object({ id: z.string().max(40), question: z.string().trim().min(3).max(500), required: z.boolean().default(false) })).max(20).default([]),
    interviewTemplateId: z.string().nullable().optional(),
    competencyIds: z.array(z.string()).max(20).optional(),
    aiDraftUsed: z.boolean().default(false),
  });

export const jobInputSchema = jobBaseSchema
  .refine((j) => j.salaryMin == null || j.salaryMax == null || j.salaryMin <= j.salaryMax, { message: "Minimum salary must not exceed maximum", path: ["salaryMin"] })
  .refine((j) => j.experienceMin == null || j.experienceMax == null || j.experienceMin <= j.experienceMax, { message: "Minimum experience must not exceed maximum", path: ["experienceMin"] });

export type JobInput = z.infer<typeof jobInputSchema>;

/** Partial update: same field rules; defaults are not applied so omitted fields stay unchanged. */
export const jobPatchSchema = z
  .object(Object.fromEntries(Object.entries(jobBaseSchema.shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? v._def.innerType : v).optional()])) as { [K in keyof typeof jobBaseSchema.shape]: z.ZodOptional<z.ZodTypeAny> })
  .refine((j) => j.salaryMin == null || j.salaryMax == null || (j.salaryMin as number) <= (j.salaryMax as number), { message: "Minimum salary must not exceed maximum", path: ["salaryMin"] });

async function validateRefs(tx: Tx, orgId: string, input: Partial<JobInput>) {
  if (input.departmentId) {
    const d = await tx.department.findFirst({ where: { id: input.departmentId, organisationId: orgId } });
    if (!d) throw notFound("Department");
  }
  if (input.interviewTemplateId) {
    const t = await tx.interviewTemplate.findFirst({ where: { id: input.interviewTemplateId, organisationId: orgId, archivedAt: null } });
    if (!t) throw notFound("Interview template");
  }
  if (input.competencyIds?.length) {
    const n = await tx.competency.count({ where: { id: { in: input.competencyIds }, organisationId: orgId, archivedAt: null } });
    if (n !== new Set(input.competencyIds).size) throw notFound("Competency");
  }
}

export async function createJob(ctx: OrgContext, input: JobInput, meta: RequestMeta) {
  ctx.assert("jobs.create");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    await validateRefs(tx, ctx.org.id, input);
    const base = slugify(input.title);
    let slug = base;
    for (let i = 2; await tx.job.findFirst({ where: { organisationId: ctx.org.id, slug } }); i++) slug = `${base}-${i}`;
    const { competencyIds, ...data } = input;
    const job = await tx.job.create({
      data: {
        ...data,
        screeningQuestions: data.screeningQuestions as Prisma.InputJsonValue,
        organisationId: ctx.org.id,
        slug,
        status: "DRAFT",
        createdById: ctx.userId,
      },
    });
    await tx.jobAssignment.create({ data: { organisationId: ctx.org.id, jobId: job.id, userId: ctx.userId, role: "RECRUITER" } });
    if (competencyIds?.length) {
      await tx.jobCompetency.createMany({ data: competencyIds.map((competencyId) => ({ organisationId: ctx.org.id, jobId: job.id, competencyId })) });
    }
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "job.created", targetType: "Job", targetId: job.id, ip: meta.ip }, tx);
    return job;
  });
}

export async function updateJob(ctx: OrgContext, jobId: string, input: Partial<JobInput>, meta: RequestMeta) {
  ctx.assert("jobs.edit");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, organisationId: ctx.org.id } });
    if (!job || !(await canAccessJob(ctx, jobId, tx))) throw notFound("Job");
    if (job.status === "ARCHIVED") throw invalidState("Archived vacancies cannot be edited");
    await validateRefs(tx, ctx.org.id, input);
    const { competencyIds, ...data } = input;
    const updated = await tx.job.update({
      where: { id: job.id },
      data: {
        ...data,
        ...(data.screeningQuestions ? { screeningQuestions: data.screeningQuestions as Prisma.InputJsonValue } : {}),
        // Editing an AI-drafted job resets the human-review confirmation.
        ...(data.aiDraftUsed ? { aiDraftReviewedById: null } : {}),
      },
    });
    if (competencyIds) {
      await tx.jobCompetency.deleteMany({ where: { jobId: job.id, organisationId: ctx.org.id } });
      if (competencyIds.length) await tx.jobCompetency.createMany({ data: competencyIds.map((competencyId) => ({ organisationId: ctx.org.id, jobId: job.id, competencyId })) });
    }
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "job.updated", targetType: "Job", targetId: job.id, ip: meta.ip, metadata: { fields: Object.keys(input) } }, tx);
    return updated;
  });
}

export async function changeJobStatus(ctx: OrgContext, jobId: string, action: JobAction, opts: { confirmHumanReview?: boolean }, meta: RequestMeta) {
  ctx.assert("jobs.publish");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, organisationId: ctx.org.id } });
    if (!job || !(await canAccessJob(ctx, jobId, tx))) throw notFound("Job");
    const next = nextJobStatus(job.status, action);
    if (!next) throw invalidState(`Cannot ${action} a ${job.status.toLowerCase()} vacancy`);
    const extra: Prisma.JobUpdateInput = {};
    if (action === "publish" || action === "reopen") {
      if (job.aiDraftUsed && !job.aiDraftReviewedById) {
        if (!opts.confirmHumanReview) throw new AppError("BAD_REQUEST", "This vacancy was drafted with AI. Confirm you have reviewed it before publishing.", { requiresReview: true });
        extra.aiDraftReviewedById = ctx.userId;
      }
      if (job.applicationDeadline && job.applicationDeadline < new Date()) throw invalidState("The application deadline is in the past");
      if (ctx.org.status !== "ACTIVE") throw forbidden("Organisation is not active");
      extra.publishedAt = job.publishedAt ?? new Date();
    }
    if (action === "close") extra.closedAt = new Date();
    const updated = await tx.job.update({ where: { id: job.id }, data: { status: next, ...extra } });
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: `job.${action}`, targetType: "Job", targetId: job.id, ip: meta.ip, metadata: { from: job.status, to: next } }, tx);
    return updated;
  });
}

export const jobListQuery = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "PAUSED", "CLOSED", "ARCHIVED"]).optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listJobs(ctx: OrgContext, q: z.infer<typeof jobListQuery>) {
  if (!ctx.can("jobs.view_all") && !ctx.can("jobs.view_assigned")) throw forbidden();
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const where: Prisma.JobWhereInput = {
      organisationId: ctx.org.id,
      ...(q.status ? { status: q.status } : { status: { not: "ARCHIVED" } }),
      ...(q.q ? { title: { contains: q.q, mode: "insensitive" } } : {}),
      ...(!ctx.can("jobs.view_all") ? { assignments: { some: { userId: ctx.userId } } } : {}),
    };
    const [items, total] = await Promise.all([
      tx.job.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { department: { select: { name: true } }, _count: { select: { applications: true } } },
      }),
      tx.job.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
}

export async function getJob(ctx: OrgContext, jobId: string) {
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const job = await tx.job.findFirst({
      where: { id: jobId, organisationId: ctx.org.id },
      include: {
        department: true,
        interviewTemplate: { select: { id: true, name: true, mode: true } },
        competencies: { include: { competency: true } },
        assignments: true,
        _count: { select: { applications: true } },
      },
    });
    if (!job || !(await canAccessJob(ctx, jobId, tx))) throw notFound("Job");
    return job;
  });
}

export const assignmentSchema = z.object({
  assignments: z.array(z.object({ userId: z.string(), role: z.enum(["RECRUITER", "HIRING_MANAGER", "REVIEWER"]) })).max(50),
});

export async function setJobAssignments(ctx: OrgContext, jobId: string, input: z.infer<typeof assignmentSchema>, meta: RequestMeta) {
  ctx.assert("jobs.edit");
  const memberIds = new Set(
    (await prisma.organisationMembership.findMany({ where: { organisationId: ctx.org.id, status: "ACTIVE" }, select: { userId: true } })).map((m) => m.userId),
  );
  for (const a of input.assignments) if (!memberIds.has(a.userId)) throw notFound("Member");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, organisationId: ctx.org.id } });
    if (!job || !(await canAccessJob(ctx, jobId, tx))) throw notFound("Job");
    await tx.jobAssignment.deleteMany({ where: { jobId, organisationId: ctx.org.id } });
    const unique = [...new Map(input.assignments.map((a) => [`${a.userId}:${a.role}`, a])).values()];
    await tx.jobAssignment.createMany({ data: unique.map((a) => ({ ...a, jobId, organisationId: ctx.org.id })) });
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "job.team_updated", targetType: "Job", targetId: jobId, ip: meta.ip, metadata: { count: unique.length } }, tx);
    return tx.jobAssignment.findMany({ where: { jobId } });
  });
}

export const jdDraftSchema = z.object({
  title: z.string().trim().min(2).max(160),
  seniority: z.string().max(60).optional(),
  notes: z.string().max(4000).optional(),
  location: z.string().max(160).optional(),
  employmentType: z.string().max(40).optional(),
});

/** AI-assisted draft — returned to the editor, never auto-published. */
export async function draftJobDescription(ctx: OrgContext, input: z.infer<typeof jdDraftSchema>) {
  ctx.assert("jobs.create");
  const res = await aiJson({ kind: "ORG", organisationId: ctx.org.id, userId: ctx.userId }, "JOB_DRAFTING", {
    purpose: JD_PROMPT_VERSION,
    system: JD_SYSTEM,
    user: `Draft a job description for ${ctx.org.name}.\n${inputBlock(input)}`,
    schema: JobDraftSchema,
    effort: "low",
  });
  return { ...res.data, model: res.model, providerMode: res.mode, aiSource: res.resolution.source, promptVersion: JD_PROMPT_VERSION, requiresHumanReview: true };
}

// ─────────────── Public / student discovery ───────────────

export const discoverQuery = z.object({
  q: z.string().max(100).optional(),
  remote: z.enum(["ONSITE", "HYBRID", "REMOTE"]).optional(),
  type: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "TEMPORARY", "GRADUATE_PROGRAMME"]).optional(),
  country: z.string().length(2).optional(),
  skill: z.string().max(60).optional(),
  campus: z.enum(["true", "false"]).optional(),
  eligibleOnly: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const publicJobSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  responsibilities: true,
  requiredQualifications: true,
  requiredSkills: true,
  preferredSkills: true,
  location: true,
  country: true,
  remotePolicy: true,
  employmentType: true,
  experienceMin: true,
  experienceMax: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryPeriod: true,
  openings: true,
  applicationDeadline: true,
  visibility: true,
  campusHiring: true,
  eligibleGraduationYears: true,
  eligibleDegrees: true,
  eligibleProgrammeIds: true,
  screeningQuestions: true,
  publishedAt: true,
  organisationId: true,
  organisation: { select: { name: true, slug: true, website: true, industry: true, verificationStatus: true, description: true, country: true } },
} satisfies Prisma.JobSelect;

export type PublicJob = Prisma.JobGetPayload<{ select: typeof publicJobSelect }>;

export type StudentEligibility = { graduationYear: number | null; degrees: string[]; programmeIds: string[] };

/** Explainable eligibility — based only on stated qualifications, never protected characteristics. */
export function eligibilityFor(job: Pick<PublicJob, "eligibleGraduationYears" | "eligibleDegrees" | "eligibleProgrammeIds" | "visibility">, s: StudentEligibility | null) {
  const reasons: string[] = [];
  const unmet: string[] = [];
  if (job.eligibleGraduationYears.length) {
    if (s?.graduationYear && job.eligibleGraduationYears.includes(s.graduationYear)) reasons.push(`Graduation year ${s.graduationYear} is eligible`);
    else unmet.push(`Open to graduation years ${job.eligibleGraduationYears.join(", ")}`);
  }
  if (job.eligibleDegrees.length) {
    const match = s?.degrees.find((d) => job.eligibleDegrees.some((e) => d.toLowerCase().includes(e.toLowerCase())));
    if (match) reasons.push(`Your degree (${match}) matches`);
    else unmet.push(`Requires: ${job.eligibleDegrees.join(" / ")}`);
  }
  if (job.visibility === "CAMPUS" && job.eligibleProgrammeIds.length) {
    if (s?.programmeIds.some((p) => job.eligibleProgrammeIds.includes(p))) reasons.push("Open to your placement programme");
    else unmet.push("Only open to specific placement programmes");
  }
  return { eligible: unmet.length === 0, reasons, unmet };
}

export async function studentEligibilityProfile(userId: string): Promise<StudentEligibility | null> {
  const sp = await prisma.studentProfile.findUnique({ where: { userId }, include: { education: true } });
  if (!sp) return null;
  // Own membership rows are visible via the cohort_member_self policy; the cohort itself is
  // university-owned, so its programme id is resolved narrowly from those ids only.
  const memberships = await withUser(userId, (tx) => tx.cohortMembership.findMany({ where: { userId, status: "ACTIVE" }, select: { cohortId: true } }));
  const cohorts = memberships.length
    ? await withSystem("student eligibility: programme ids of own cohorts", (tx) => tx.studentCohort.findMany({ where: { id: { in: memberships.map((m) => m.cohortId) } }, select: { programmeId: true } }))
    : [];
  return {
    graduationYear: sp.graduationYear ?? sp.education.find((e) => e.graduationYear)?.graduationYear ?? null,
    degrees: [sp.currentDegree, ...sp.education.map((e) => e.degree)].filter(Boolean) as string[],
    programmeIds: cohorts.map((c) => c.programmeId).filter(Boolean) as string[],
  };
}

/** Discover published jobs across organisations (RLS job_public_read policy). */
export async function discoverJobs(userId: string | null, q: z.infer<typeof discoverQuery>) {
  const run = async (tx: Tx) => {
    const where: Prisma.JobWhereInput = {
      status: "PUBLISHED",
      visibility: q.campus === "true" ? "CAMPUS" : userId ? { in: ["PUBLIC", "CAMPUS"] } : "PUBLIC",
      organisation: { status: "ACTIVE" },
      OR: [{ applicationDeadline: null }, { applicationDeadline: { gte: new Date() } }],
      ...(q.remote ? { remotePolicy: q.remote } : {}),
      ...(q.type ? { employmentType: q.type } : {}),
      ...(q.country ? { country: q.country.toUpperCase() } : {}),
      ...(q.skill ? { OR: [{ requiredSkills: { has: q.skill } }, { preferredSkills: { has: q.skill } }] } : {}),
      ...(q.q ? { AND: [{ OR: [{ title: { contains: q.q, mode: "insensitive" } }, { description: { contains: q.q, mode: "insensitive" } }] }] } : {}),
    };
    const [items, total] = await Promise.all([
      tx.job.findMany({ where, select: publicJobSelect, orderBy: { publishedAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      tx.job.count({ where }),
    ]);
    return { items, total };
  };
  const { items, total } = userId ? await withUser(userId, run) : await withUser("anonymous", run);
  const elig = userId ? await studentEligibilityProfile(userId) : null;
  const saved = userId ? new Set((await prisma.savedJob.findMany({ where: { userId }, select: { jobId: true } })).map((s) => s.jobId)) : new Set<string>();
  const enriched = items.map((j) => ({ ...j, eligibility: eligibilityFor(j, elig), saved: saved.has(j.id) }));
  const filtered = q.eligibleOnly === "true" ? enriched.filter((j) => j.eligibility.eligible) : enriched;
  return { items: filtered, total, page: q.page, pageSize: q.pageSize };
}

export async function getPublicJob(userId: string | null, jobId: string) {
  const job = await withUser(userId ?? "anonymous", (tx) =>
    tx.job.findFirst({ where: { id: jobId, status: "PUBLISHED", visibility: { in: userId ? ["PUBLIC", "CAMPUS"] : ["PUBLIC"] }, organisation: { status: "ACTIVE" } }, select: publicJobSelect }),
  );
  if (!job) throw notFound("Job");
  const elig = userId ? await studentEligibilityProfile(userId) : null;
  return { ...job, eligibility: eligibilityFor(job, elig) };
}

/** Explainable recommendations: skill overlap + eligibility + stated preferences. */
export async function recommendJobs(userId: string, limit = 6) {
  const sp = await prisma.studentProfile.findUnique({ where: { userId }, include: { skills: true, preference: true } });
  const { items } = await discoverJobs(userId, { page: 1, pageSize: 50 });
  const skills = new Set((sp?.skills ?? []).map((s) => s.name.toLowerCase()));
  const desiredRoles = (sp?.preference?.desiredRoles ?? []).map((r) => r.toLowerCase());
  const scored = items
    .filter((j) => j.eligibility.eligible)
    .map((j) => {
      const why: string[] = [...j.eligibility.reasons];
      const overlap = [...j.requiredSkills, ...j.preferredSkills].filter((s) => skills.has(s.toLowerCase()));
      if (overlap.length) why.push(`Matches your skills: ${overlap.slice(0, 4).join(", ")}`);
      const roleMatch = desiredRoles.some((r) => j.title.toLowerCase().includes(r));
      if (roleMatch) why.push("Matches a role you're interested in");
      if (sp?.preference?.remotePolicies.includes(j.remotePolicy)) why.push(`${j.remotePolicy.toLowerCase()} work matches your preference`);
      return { job: j, score: overlap.length * 2 + (roleMatch ? 3 : 0) + (why.length ? 1 : 0), why };
    })
    .filter((r) => r.why.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((r) => ({ ...r.job, why: r.why }));
}

export async function toggleSavedJob(userId: string, jobId: string, save: boolean) {
  if (save) {
    await getPublicJob(userId, jobId);
    await prisma.savedJob.upsert({ where: { userId_jobId: { userId, jobId } }, create: { userId, jobId }, update: {} });
  } else {
    await prisma.savedJob.deleteMany({ where: { userId, jobId } });
  }
  return { saved: save };
}

export async function listSavedJobs(userId: string) {
  const saved = await prisma.savedJob.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { jobId: true, createdAt: true } });
  const jobs = await withUser(userId, (tx) => tx.job.findMany({ where: { id: { in: saved.map((s) => s.jobId) } }, select: publicJobSelect }));
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return saved.map((s) => ({ savedAt: s.createdAt, job: byId.get(s.jobId) ?? null, available: byId.has(s.jobId) }));
}
