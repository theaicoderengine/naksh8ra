import { z } from "zod";
import { prisma } from "../db/client";
import { withOrg, withSystem } from "../db/tenant";
import { badRequest, forbidden, notFound } from "../errors";
import { audit } from "../audit";
import type { OrgContext } from "../auth/context";
import { sendEmail } from "./notifications";
import { env } from "../env";
import type { RequestMeta } from "../http/route";

function assertUniversity(ctx: OrgContext) {
  if (ctx.org.type !== "UNIVERSITY") throw forbidden("Placement features are only available to university workspaces");
}

export const programmeSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  academicYear: z.string().trim().max(20).nullable().optional(),
  eligibility: z.object({ graduationYears: z.array(z.number().int()).max(10).default([]), degrees: z.array(z.string().max(120)).max(20).default([]) }).default({}),
  isActive: z.boolean().default(true),
});

export async function listProgrammes(ctx: OrgContext) {
  assertUniversity(ctx);
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const ps = await tx.placementProgramme.findMany({ where: { organisationId: ctx.org.id }, include: { cohorts: { include: { _count: { select: { members: true } } } }, employers: true }, orderBy: { createdAt: "desc" } });
    const employerIds = [...new Set(ps.flatMap((p) => p.employers.map((e) => e.employerOrganisationId)))];
    const orgs = await prisma.organisation.findMany({ where: { id: { in: employerIds } }, select: { id: true, name: true, slug: true } });
    return ps.map((p) => ({ ...p, employers: p.employers.map((e) => ({ ...e, organisation: orgs.find((o) => o.id === e.employerOrganisationId) ?? null })) }));
  });
}

export async function saveProgramme(ctx: OrgContext, id: string | null, input: z.infer<typeof programmeSchema>, meta: RequestMeta) {
  assertUniversity(ctx);
  ctx.assert("university.manage");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    let p;
    if (id) {
      const existing = await tx.placementProgramme.findFirst({ where: { id, organisationId: ctx.org.id } });
      if (!existing) throw notFound("Programme");
      p = await tx.placementProgramme.update({ where: { id }, data: input });
    } else {
      p = await tx.placementProgramme.create({ data: { ...input, organisationId: ctx.org.id } });
    }
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: id ? "programme.updated" : "programme.created", targetType: "PlacementProgramme", targetId: p.id, ip: meta.ip }, tx);
    return p;
  });
}

export async function inviteEmployerToProgramme(ctx: OrgContext, programmeId: string, employerSlug: string, meta: RequestMeta) {
  assertUniversity(ctx);
  ctx.assert("university.manage");
  const employer = await prisma.organisation.findFirst({ where: { slug: employerSlug, type: "EMPLOYER", status: "ACTIVE" } });
  if (!employer) throw notFound("Employer");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const p = await tx.placementProgramme.findFirst({ where: { id: programmeId, organisationId: ctx.org.id } });
    if (!p) throw notFound("Programme");
    const pe = await tx.programmeEmployer.upsert({ where: { programmeId_employerOrganisationId: { programmeId, employerOrganisationId: employer.id } }, create: { programmeId, employerOrganisationId: employer.id }, update: {} });
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "programme.employer_invited", targetType: "ProgrammeEmployer", targetId: pe.id, ip: meta.ip, metadata: { employer: employer.id } }, tx);
    return pe;
  });
}

/** Employer side: programmes this employer is invited to / participates in. */
export async function employerProgrammes(ctx: OrgContext) {
  const links = await prisma.programmeEmployer.findMany({ where: { employerOrganisationId: ctx.org.id } });
  const programmes = await withSystem("employer programme listing", (tx) =>
    tx.placementProgramme.findMany({ where: { id: { in: links.map((l) => l.programmeId) } }, select: { id: true, name: true, academicYear: true, eligibility: true, organisation: { select: { name: true } } } }),
  );
  return links.map((l) => ({ ...l, programme: programmes.find((p) => p.id === l.programmeId) ?? null }));
}

export async function respondProgrammeInvite(ctx: OrgContext, linkId: string, accept: boolean, meta: RequestMeta) {
  ctx.assert("jobs.publish");
  const link = await prisma.programmeEmployer.findFirst({ where: { id: linkId, employerOrganisationId: ctx.org.id } });
  if (!link) throw notFound("Programme invitation");
  await prisma.programmeEmployer.update({ where: { id: link.id }, data: { status: accept ? "ACTIVE" : "ENDED" } });
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: accept ? "programme.joined" : "programme.declined", targetType: "ProgrammeEmployer", targetId: link.id, ip: meta.ip });
}

// ───────────────────────── Cohorts ─────────────────────────

export const cohortSchema = z.object({ name: z.string().trim().min(2).max(120), programmeId: z.string().nullable().optional(), graduationYear: z.number().int().min(1950).max(2100).nullable().optional() });

export async function listCohorts(ctx: OrgContext) {
  assertUniversity(ctx);
  return withOrg(ctx.org.id, ctx.userId, (tx) => tx.studentCohort.findMany({ where: { organisationId: ctx.org.id }, include: { programme: { select: { name: true } }, _count: { select: { members: true } } }, orderBy: { createdAt: "desc" } }));
}

export async function createCohort(ctx: OrgContext, input: z.infer<typeof cohortSchema>, meta: RequestMeta) {
  assertUniversity(ctx);
  ctx.assert("university.manage");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    if (input.programmeId && !(await tx.placementProgramme.findFirst({ where: { id: input.programmeId, organisationId: ctx.org.id } }))) throw notFound("Programme");
    const c = await tx.studentCohort.create({ data: { ...input, organisationId: ctx.org.id } });
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "cohort.created", targetType: "StudentCohort", targetId: c.id, ip: meta.ip }, tx);
    return c;
  });
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ImportReport = { invited: number; skipped: number; errors: { line: number; message: string }[] };

/** Parse a CSV of students: header must include `email`; optional `student_number`. */
export function parseStudentCsv(csv: string): { rows: { email: string; studentNumber: string | null }[]; errors: { line: number; message: string }[] } {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { rows: [], errors: [{ line: 1, message: "File is empty" }] };
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  const ei = header.indexOf("email");
  const si = header.indexOf("student_number");
  if (ei === -1) return { rows: [], errors: [{ line: 1, message: "Missing required column: email" }] };
  if (lines.length > 5001) return { rows: [], errors: [{ line: 1, message: "Maximum 5,000 students per import" }] };
  const rows: { email: string; studentNumber: string | null }[] = [];
  const errors: { line: number; message: string }[] = [];
  const seen = new Set<string>();
  lines.slice(1).forEach((l, i) => {
    const cells = l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const email = (cells[ei] ?? "").toLowerCase();
    if (!emailRe.test(email)) return errors.push({ line: i + 2, message: `Invalid email "${email.slice(0, 60)}"` });
    if (seen.has(email)) return errors.push({ line: i + 2, message: `Duplicate email ${email}` });
    seen.add(email);
    const sn = si >= 0 ? cells[si]?.slice(0, 40) || null : null;
    rows.push({ email, studentNumber: sn });
  });
  return { rows, errors };
}

export async function inviteStudents(ctx: OrgContext, cohortId: string, rows: { email: string; studentNumber: string | null }[], meta: RequestMeta): Promise<ImportReport> {
  assertUniversity(ctx);
  ctx.assert("university.import");
  if (rows.length > 5000) throw badRequest("Maximum 5,000 students per import");
  const cohort = await withOrg(ctx.org.id, ctx.userId, (tx) => tx.studentCohort.findFirst({ where: { id: cohortId, organisationId: ctx.org.id } }));
  if (!cohort) throw notFound("Cohort");
  let invited = 0;
  let skipped = 0;
  for (const r of rows) {
    const created = await withOrg(ctx.org.id, ctx.userId, async (tx) => {
      const existing = await tx.cohortMembership.findUnique({ where: { cohortId_inviteEmail: { cohortId, inviteEmail: r.email } } });
      if (existing) return null;
      return tx.cohortMembership.create({ data: { organisationId: ctx.org.id, cohortId, inviteEmail: r.email, studentNumber: r.studentNumber } });
    });
    if (!created) {
      skipped++;
      continue;
    }
    invited++;
    await sendEmail("cohortInvitation", { university: ctx.org.name, cohort: cohort.name, url: `${env().APP_URL}/student/settings#cohorts` }, { to: r.email, organisationId: ctx.org.id, idempotencyKey: `cohort-invite:${created.id}` });
  }
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "cohort.students_invited", targetType: "StudentCohort", targetId: cohortId, ip: meta.ip, metadata: { invited, skipped } });
  return { invited, skipped, errors: [] };
}

/**
 * Cohort members. The university sees full detail only for students who
 * accepted (consented); invitees appear as email + status only. Progress is
 * aggregate counts — never employer assessments, recordings or HR notes.
 */
export async function cohortMembers(ctx: OrgContext, cohortId: string) {
  assertUniversity(ctx);
  ctx.assert("university.students.view");
  const members = await withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const c = await tx.studentCohort.findFirst({ where: { id: cohortId, organisationId: ctx.org.id } });
    if (!c) throw notFound("Cohort");
    return tx.cohortMembership.findMany({ where: { cohortId, organisationId: ctx.org.id }, orderBy: { createdAt: "asc" } });
  });
  const consenting = members.filter((m) => m.status === "ACTIVE" && m.userId);
  const userIds = consenting.map((m) => m.userId!) as string[];
  const [profiles, progress] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, profile: { select: { firstName: true, lastName: true } }, studentProfile: { select: { currentDegree: true, graduationYear: true, onboardingCompletedAt: true } } } }),
    withSystem("cohort aggregate progress", (tx) =>
      tx.application.groupBy({ by: ["candidateUserId", "status"], where: { candidateUserId: { in: userIds }, status: { not: "DRAFT" } }, _count: { _all: true } }),
    ),
  ]);
  return members.map((m) => {
    if (m.status !== "ACTIVE" || !m.userId) return { id: m.id, email: m.inviteEmail, studentNumber: m.studentNumber, status: m.status, consented: false };
    const p = profiles.find((x) => x.id === m.userId);
    const counts = Object.fromEntries(progress.filter((g) => g.candidateUserId === m.userId).map((g) => [g.status, g._count._all]));
    return {
      id: m.id,
      email: m.inviteEmail,
      studentNumber: m.studentNumber,
      status: m.status,
      consented: true,
      name: p ? `${p.profile?.firstName ?? ""} ${p.profile?.lastName ?? ""}`.trim() : null,
      degree: p?.studentProfile?.currentDegree ?? null,
      graduationYear: p?.studentProfile?.graduationYear ?? null,
      profileComplete: !!p?.studentProfile?.onboardingCompletedAt,
      applications: counts,
    };
  });
}

export async function removeCohortMember(ctx: OrgContext, membershipId: string, meta: RequestMeta) {
  assertUniversity(ctx);
  ctx.assert("university.manage");
  await withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const m = await tx.cohortMembership.findFirst({ where: { id: membershipId, organisationId: ctx.org.id } });
    if (!m) throw notFound("Member");
    await tx.cohortMembership.update({ where: { id: m.id }, data: { status: "REMOVED" } });
  });
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "cohort.member_removed", targetType: "CohortMembership", targetId: membershipId, ip: meta.ip });
}

/** Aggregate cohort analytics (counts only, small cells suppressed to avoid re-identification). */
export async function cohortAnalytics(ctx: OrgContext) {
  assertUniversity(ctx);
  ctx.assert("analytics.view");
  const members = await withOrg(ctx.org.id, ctx.userId, (tx) => tx.cohortMembership.findMany({ where: { organisationId: ctx.org.id }, select: { cohortId: true, status: true, userId: true } }));
  const cohorts = await listCohorts(ctx);
  const active = members.filter((m) => m.status === "ACTIVE" && m.userId);
  const groups = await withSystem("cohort analytics", (tx) =>
    tx.application.groupBy({ by: ["candidateUserId", "status"], where: { candidateUserId: { in: active.map((m) => m.userId!) }, status: { not: "DRAFT" } }, _count: { _all: true } }),
  );
  const SUPPRESS = 5;
  return cohorts.map((c) => {
    const ids = new Set(active.filter((m) => m.cohortId === c.id).map((m) => m.userId!));
    const applied = new Set(groups.filter((g) => ids.has(g.candidateUserId!)).map((g) => g.candidateUserId));
    const offers = new Set(groups.filter((g) => ids.has(g.candidateUserId!) && ["OFFER", "HIRED"].includes(g.status)).map((g) => g.candidateUserId));
    const hired = new Set(groups.filter((g) => ids.has(g.candidateUserId!) && g.status === "HIRED").map((g) => g.candidateUserId));
    const sup = (n: number) => (n > 0 && n < SUPPRESS ? `<${SUPPRESS}` : n);
    return {
      cohortId: c.id,
      name: c.name,
      invited: members.filter((m) => m.cohortId === c.id).length,
      joined: ids.size,
      studentsApplied: sup(applied.size),
      studentsWithOffers: sup(offers.size),
      studentsHired: sup(hired.size),
    };
  });
}

/** Opportunities from participating employers targeted at this university's programmes. */
export async function programmeOpportunities(ctx: OrgContext) {
  assertUniversity(ctx);
  const programmes = await withOrg(ctx.org.id, ctx.userId, (tx) => tx.placementProgramme.findMany({ where: { organisationId: ctx.org.id }, select: { id: true, name: true } }));
  const ids = programmes.map((p) => p.id);
  const jobs = await withSystem("programme opportunities", (tx) =>
    tx.job.findMany({ where: { status: "PUBLISHED", visibility: { in: ["CAMPUS", "PUBLIC"] }, eligibleProgrammeIds: { hasSome: ids } }, select: { id: true, title: true, eligibleProgrammeIds: true, applicationDeadline: true, organisation: { select: { name: true } } } }),
  );
  return jobs.map((j) => ({ ...j, programmes: programmes.filter((p) => j.eligibleProgrammeIds.includes(p.id)).map((p) => p.name) }));
}
