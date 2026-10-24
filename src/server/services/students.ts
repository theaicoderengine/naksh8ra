import { z } from "zod";
import { prisma } from "../db/client";
import { withOrg, withUser } from "../db/tenant";
import { badRequest, notFound, forbidden } from "../errors";
import { audit } from "../audit";
import type { SessionInfo } from "../auth/session";
import { sendEmail } from "./notifications";
import { env } from "../env";
import { listMyApplications } from "./applications";
import { recommendJobs, listSavedJobs } from "./jobs";
import { listResumes } from "./resumes";
import type { RequestMeta } from "../http/route";

const opt = (max: number) => z.string().trim().max(max).nullable().optional();
const date = z.coerce.date().nullable().optional();

export const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: opt(40),
  headline: opt(200),
  bio: opt(3000),
  country: z.string().trim().length(2).toUpperCase().nullable().optional(),
  city: opt(120),
  workArrangement: z.enum(["ONSITE", "HYBRID", "REMOTE"]).nullable().optional(),
  graduationYear: z.number().int().min(1950).max(2100).nullable().optional(),
  currentInstitution: opt(200),
  currentDegree: opt(200),
  fieldOfStudy: opt(200),
  languages: z.array(z.string().trim().max(60)).max(20).optional(),
  links: z.array(z.object({ label: z.string().trim().max(60), url: z.string().trim().url().max(500).refine((u) => /^https?:\/\//.test(u), "Use an http(s) link") })).max(10).optional(),
  visibility: z.enum(["PRIVATE", "EMPLOYERS_I_APPLY_TO"]).optional(),
  skills: z.array(z.object({ name: z.string().trim().min(1).max(60), level: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).nullable().optional() })).max(60).optional(),
  education: z.array(z.object({ institution: z.string().trim().min(1).max(200), degree: z.string().trim().min(1).max(200), fieldOfStudy: opt(200), startDate: date, endDate: date, graduationYear: z.number().int().min(1950).max(2100).nullable().optional(), grade: opt(40) })).max(10).optional(),
  projects: z.array(z.object({ title: z.string().trim().min(1).max(200), description: opt(2000), url: z.string().trim().url().max(500).nullable().optional(), skills: z.array(z.string().max(60)).max(20).default([]) })).max(20).optional(),
  certifications: z.array(z.object({ name: z.string().trim().min(1).max(200), issuer: opt(200), issuedAt: date, url: z.string().trim().url().max(500).nullable().optional() })).max(20).optional(),
  experiences: z.array(z.object({ kind: z.enum(["INTERNSHIP", "EMPLOYMENT", "VOLUNTEER"]), organisation: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(200), description: opt(3000), startDate: date, endDate: date })).max(20).optional(),
  preferences: z
    .object({
      desiredRoles: z.array(z.string().trim().max(80)).max(10),
      desiredLocations: z.array(z.string().trim().max(80)).max(10),
      remotePolicies: z.array(z.enum(["ONSITE", "HYBRID", "REMOTE"])).max(3),
      employmentTypes: z.array(z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "TEMPORARY", "GRADUATE_PROGRAMME"])).max(6),
      opportunityAlerts: z.boolean(),
    })
    .partial()
    .optional(),
  completeOnboarding: z.boolean().optional(),
});

export async function getStudentProfile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      profile: true,
      studentProfile: { include: { education: { orderBy: { graduationYear: "desc" } }, skills: true, projects: true, certifications: true, experiences: { orderBy: { startDate: "desc" } }, preference: true } },
    },
  });
  return { email: user.email, emailVerified: !!user.emailVerifiedAt, profile: user.profile, student: user.studentProfile };
}

/** Upsert the whole profile (child collections are replaced when provided). */
export async function updateStudentProfile(userId: string, input: z.infer<typeof profileSchema>) {
  const { firstName, lastName, phone, skills, education, projects, certifications, experiences, preferences, completeOnboarding, ...sp } = input;
  return prisma.$transaction(async (tx) => {
    if (firstName || lastName || phone !== undefined) {
      await tx.userProfile.update({ where: { userId }, data: { firstName, lastName, phone } });
    }
    const profile = await tx.studentProfile.upsert({
      where: { userId },
      create: { userId, ...sp, links: sp.links ?? [], languages: sp.languages ?? [] },
      update: { ...sp, ...(completeOnboarding ? { onboardingCompletedAt: new Date() } : {}) },
    });
    if (completeOnboarding && !profile.onboardingCompletedAt) await tx.studentProfile.update({ where: { id: profile.id }, data: { onboardingCompletedAt: new Date() } });
    const id = profile.id;
    if (skills) {
      await tx.studentSkill.deleteMany({ where: { studentProfileId: id } });
      const uniq = [...new Map(skills.map((s) => [s.name.toLowerCase(), s])).values()];
      await tx.studentSkill.createMany({ data: uniq.map((s) => ({ studentProfileId: id, name: s.name, level: s.level ?? null })) });
    }
    if (education) {
      await tx.educationRecord.deleteMany({ where: { studentProfileId: id } });
      await tx.educationRecord.createMany({ data: education.map((e) => ({ ...e, studentProfileId: id })) });
    }
    if (projects) {
      await tx.studentProject.deleteMany({ where: { studentProfileId: id } });
      await tx.studentProject.createMany({ data: projects.map((p) => ({ ...p, studentProfileId: id })) });
    }
    if (certifications) {
      await tx.studentCertification.deleteMany({ where: { studentProfileId: id } });
      await tx.studentCertification.createMany({ data: certifications.map((c) => ({ ...c, studentProfileId: id })) });
    }
    if (experiences) {
      await tx.studentExperience.deleteMany({ where: { studentProfileId: id } });
      await tx.studentExperience.createMany({ data: experiences.map((e) => ({ ...e, studentProfileId: id })) });
    }
    if (preferences) {
      await tx.studentPreference.upsert({ where: { studentProfileId: id }, create: { studentProfileId: id, desiredRoles: [], desiredLocations: [], remotePolicies: [], employmentTypes: [], ...preferences }, update: preferences });
      if (preferences.opportunityAlerts !== undefined) {
        await tx.notificationPreference.upsert({
          where: { userId_channel_topic: { userId, channel: "EMAIL", topic: "opportunity_alerts" } },
          create: { userId, channel: "EMAIL", topic: "opportunity_alerts", enabled: preferences.opportunityAlerts },
          update: { enabled: preferences.opportunityAlerts },
        });
      }
    }
    return profile;
  });
}

export async function ensureStudentProfile(session: SessionInfo) {
  const existing = await prisma.studentProfile.findUnique({ where: { userId: session.user.id } });
  if (existing) return existing;
  const p = await prisma.studentProfile.create({ data: { userId: session.user.id, links: [], languages: [] } });
  await sendEmail("studentWelcome", { name: session.user.firstName ?? "there", url: `${env().APP_URL}/student` }, { to: session.user.email, userId: session.user.id, idempotencyKey: `student-welcome:${session.user.id}` });
  return p;
}

/** Weighted completion indicator with actionable missing items. */
export function profileCompletion(p: Awaited<ReturnType<typeof getStudentProfile>>, resumeCount: number) {
  const s = p.student;
  const checks: [string, boolean, number][] = [
    ["Name", !!(p.profile?.firstName && p.profile?.lastName), 10],
    ["Verified email", p.emailVerified, 10],
    ["Headline", !!s?.headline, 10],
    ["Location", !!(s?.country || s?.city), 5],
    ["Education", (s?.education.length ?? 0) > 0, 15],
    ["Graduation year", !!s?.graduationYear, 10],
    ["Skills (3+)", (s?.skills.length ?? 0) >= 3, 15],
    ["Resume", resumeCount > 0, 15],
    ["Project, internship or experience", (s?.projects.length ?? 0) + (s?.experiences.length ?? 0) > 0, 5],
    ["Career preferences", (s?.preference?.desiredRoles.length ?? 0) > 0, 5],
  ];
  const total = checks.reduce((a, [, , w]) => a + w, 0);
  const done = checks.filter(([, ok]) => ok).reduce((a, [, , w]) => a + w, 0);
  return { percent: Math.round((done / total) * 100), missing: checks.filter(([, ok]) => !ok).map(([n]) => n) };
}

export async function studentDashboard(userId: string) {
  const [profile, resumes, applications, saved, recommended, notifications, practice, cohortInvites] = await Promise.all([
    getStudentProfile(userId),
    listResumes(userId),
    listMyApplications(userId),
    listSavedJobs(userId),
    recommendJobs(userId, 5).catch(() => []),
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.practiceInterview.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, targetRole: true, status: true, createdAt: true, completedAt: true } }),
    listCohortInvites(userId),
  ]);
  const invitations = await withUser(userId, (tx) =>
    tx.interviewInvitation.findMany({
      where: { revokedAt: null, application: { candidateUserId: userId }, session: { status: { in: ["INVITED", "READY", "IN_PROGRESS", "INTERRUPTED"] } } },
      select: { id: true, expiresAt: true, applicationId: true, session: { select: { status: true } } },
    }),
  );
  return {
    completion: profileCompletion(profile, resumes.length),
    profile,
    applications,
    saved,
    recommended,
    notifications,
    practice,
    pendingInterviews: invitations.map((i) => ({ invitationId: i.id, applicationId: i.applicationId, expiresAt: i.expiresAt, status: i.session?.status === "IN_PROGRESS" || i.session?.status === "INTERRUPTED" ? "IN_PROGRESS" : "PENDING", job: applications.find((a) => a.id === i.applicationId)?.job ?? null })),
    cohortInvites,
  };
}

// ───────────────────────── Accommodations (private workflow) ─────────────────────────

export const accommodationSchema = z.object({ details: z.string().trim().min(10).max(3000), applicationId: z.string().optional() });

export async function requestAccommodation(userId: string, input: z.infer<typeof accommodationSchema>, meta: RequestMeta) {
  let organisationId: string | null = null;
  if (input.applicationId) {
    const app = await withUser(userId, (tx) => tx.application.findFirst({ where: { id: input.applicationId, candidateUserId: userId } }));
    if (!app) throw notFound("Application");
    organisationId = app.organisationId;
  }
  const sp = await prisma.studentProfile.findUnique({ where: { userId } });
  const r = await prisma.accommodationRequest.create({ data: { userId, studentProfileId: sp?.id, organisationId, applicationId: input.applicationId, details: input.details } });
  await audit({ organisationId, actorUserId: userId, actorType: "CANDIDATE", action: "accommodation.requested", targetType: "AccommodationRequest", targetId: r.id, ip: meta.ip });
  return r;
}

export async function listMyAccommodations(userId: string) {
  return prisma.accommodationRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

/** Employer view: only requests directed at this organisation, visible to HR admins/owners. */
export async function listOrgAccommodations(orgId: string) {
  return prisma.accommodationRequest.findMany({ where: { organisationId: orgId }, orderBy: { createdAt: "desc" } });
}

export async function respondAccommodation(orgId: string, actorUserId: string, id: string, status: "ACKNOWLEDGED" | "GRANTED" | "DECLINED", note?: string) {
  const r = await prisma.accommodationRequest.findFirst({ where: { id, organisationId: orgId } });
  if (!r) throw notFound("Request");
  await audit({ organisationId: orgId, actorUserId, action: "accommodation.responded", targetType: "AccommodationRequest", targetId: id, metadata: { status } });
  return prisma.accommodationRequest.update({ where: { id }, data: { status, responseNote: note } });
}

// ───────────────────────── Cohort invitations ─────────────────────────

export async function listCohortInvites(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  // Invitations are addressed by email; resolve them in a system context, then return only safe fields.
  const { withSystem } = await import("../db/tenant");
  const rows = await withSystem("student cohort invites", (tx) =>
    tx.cohortMembership.findMany({
      where: { OR: [{ userId }, { inviteEmail: user.email }], status: { in: ["INVITED", "ACTIVE"] } },
      include: { cohort: { select: { name: true, graduationYear: true, organisation: { select: { name: true } } } } },
    }),
  );
  return rows.map((r) => ({ id: r.id, status: r.status, cohort: r.cohort.name, graduationYear: r.cohort.graduationYear, university: r.cohort.organisation.name, consentedAt: r.consentedAt }));
}

export async function respondCohortInvite(userId: string, membershipId: string, accept: boolean, meta: RequestMeta) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
  if (!user.emailVerifiedAt) throw forbidden("Verify your email first");
  const { withSystem } = await import("../db/tenant");
  const m = await withSystem("cohort invite lookup", (tx) => tx.cohortMembership.findUnique({ where: { id: membershipId } }));
  if (!m || (m.userId !== userId && m.inviteEmail.toLowerCase() !== user.email.toLowerCase())) throw notFound("Invitation");
  if (m.status !== "INVITED" && accept) throw badRequest("This invitation is no longer pending");
  await withOrg(m.organisationId, userId, (tx) =>
    tx.cohortMembership.update({ where: { id: m.id }, data: accept ? { status: "ACTIVE", userId, consentedAt: new Date() } : { status: m.status === "ACTIVE" ? "REMOVED" : "DECLINED", userId } }),
  );
  await prisma.consentRecord.create({ data: { userId, organisationId: m.organisationId, type: "COHORT_DATA_SHARING", granted: accept, noticeVersion: "cohort-2026-10", ipAddress: meta.ip, userAgent: meta.userAgent } });
  await audit({ organisationId: m.organisationId, actorUserId: userId, actorType: "CANDIDATE", action: accept ? "cohort.joined" : "cohort.left", targetType: "CohortMembership", targetId: m.id, ip: meta.ip });
  return { ok: true };
}

// ───────────────────────── Notification preferences ─────────────────────────

export const prefsSchema = z.object({ prefs: z.array(z.object({ channel: z.enum(["EMAIL", "IN_APP"]), topic: z.enum(["opportunity_alerts", "interview_reminders", "application_updates", "product"]), enabled: z.boolean() })).max(20) });

export async function getNotificationPrefs(userId: string) {
  const rows = await prisma.notificationPreference.findMany({ where: { userId } });
  const defaults = { opportunity_alerts: false, interview_reminders: true, application_updates: true, product: false } as Record<string, boolean>;
  const out: { channel: string; topic: string; enabled: boolean }[] = [];
  for (const channel of ["EMAIL", "IN_APP"]) for (const topic of Object.keys(defaults)) out.push({ channel, topic, enabled: rows.find((r) => r.channel === channel && r.topic === topic)?.enabled ?? (channel === "IN_APP" ? true : defaults[topic]) });
  return out;
}

export async function setNotificationPrefs(userId: string, input: z.infer<typeof prefsSchema>) {
  for (const p of input.prefs) {
    await prisma.notificationPreference.upsert({ where: { userId_channel_topic: { userId, channel: p.channel, topic: p.topic } }, create: { userId, ...p }, update: { enabled: p.enabled } });
  }
  return getNotificationPrefs(userId);
}
