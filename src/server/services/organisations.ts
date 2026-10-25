import { z } from "zod";
import { prisma } from "../db/client";
import { withOrg, withSystem, type Tx } from "../db/tenant";
import { AppError, badRequest, forbidden, notFound, conflict } from "../errors";
import { audit } from "../audit";
import { slugify } from "@/lib/id";
import { DEFAULT_COMPETENCIES, DEFAULT_RETENTION, DEFAULT_STAGES } from "./defaults";
import { ORG_ROLES, assignableRoles, isOrgRoleKey } from "../rbac/permissions";
import type { OrgContext } from "../auth/context";
import type { SessionInfo } from "../auth/session";
import { randomToken, sha256 } from "../auth/crypto";
import { sendEmail } from "./notifications";
import { env } from "../env";
import { getEntitlements, seatsUsed } from "../billing/entitlements";
import { grant } from "../billing/credits";
import { TERMS_VERSION } from "./auth";
import type { RequestMeta } from "../http/route";

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(200).optional(),
  type: z.enum(["EMPLOYER", "UNIVERSITY"]).default("EMPLOYER"),
  website: z.string().trim().url().max(300).optional().or(z.literal("").transform(() => undefined)),
  industry: z.string().trim().max(120).optional(),
  sizeBand: z.enum(["1-10", "11-50", "51-200", "201-1000", "1001-5000", "5000+"]).optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  timezone: z.string().trim().max(60).default("UTC"),
  planKey: z.string().max(60).optional(),
  acceptTerms: z.literal(true, { error: "You must accept the customer terms" }),
});

async function uniqueSlug(name: string) {
  const base = slugify(name, 40);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (["admin", "api", "app", "www", "student", "interview", "login", "register"].includes(slug)) continue;
    const exists = await prisma.organisation.findUnique({ where: { slug } });
    if (!exists) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function systemRoleId(key: string) {
  const role = await prisma.role.findFirst({ where: { key, organisationId: null } });
  if (!role) throw new AppError("INTERNAL", `System role ${key} missing — run the database seed`);
  return role.id;
}

export async function seedOrganisationDefaults(tx: Tx, organisationId: string, actorUserId: string) {
  await tx.applicationStage.createMany({
    data: DEFAULT_STAGES.map((s, i) => ({ organisationId, key: s.key, name: s.name, kind: s.kind, position: i, isTerminal: !!s.terminal })),
  });
  for (const c of DEFAULT_COMPETENCIES) {
    const comp = await tx.competency.create({
      data: { organisationId, key: c.key, name: c.name, description: c.description, category: c.category },
    });
    await tx.competencyRubric.create({
      data: {
        organisationId,
        competencyId: comp.id,
        version: 1,
        criteria: [...c.criteria],
        indicators: c.indicators as never,
        levels: c.levels as never,
        evidenceRequirements: c.evidenceRequirements,
        scoringGuidance: c.scoringGuidance,
        createdById: actorUserId,
      },
    });
  }
}

/**
 * Create a workspace. Duplicate detection: the same name + website domain is
 * flagged for platform review (verification), not blocked — email domain
 * alone is never treated as proof of company identity.
 */
export async function createOrganisation(session: SessionInfo, input: z.infer<typeof createOrgSchema>, meta: RequestMeta) {
  if (!session.user.emailVerifiedAt) throw forbidden("Verify your email before creating an organisation");
  const ownedCount = await prisma.organisationMembership.count({ where: { userId: session.user.id, role: { key: "OWNER" } } });
  if (ownedCount >= 5) throw badRequest("You already own the maximum number of workspaces. Contact sales for more.");

  const domain = input.website ? new URL(input.website).hostname.replace(/^www\./, "") : null;
  const possibleDuplicate = await prisma.organisation.findFirst({
    where: {
      name: { equals: input.name, mode: "insensitive" },
      ...(domain ? { website: { contains: domain } } : {}),
    },
    select: { id: true },
  });

  const slug = await uniqueSlug(input.name);
  const ownerRoleId = await systemRoleId("OWNER");
  const plan = input.planKey ? await prisma.plan.findFirst({ where: { key: input.planKey, isActive: true, isPublic: true } }) : null;

  const org = await prisma.organisation.create({
    data: {
      slug,
      name: input.name,
      legalName: input.legalName,
      type: input.type,
      website: input.website,
      industry: input.industry,
      sizeBand: input.sizeBand,
      country: input.country,
      timezone: input.timezone,
      billingEmail: session.user.email,
      status: "ACTIVE",
      verificationStatus: possibleDuplicate ? "PENDING" : "UNVERIFIED",
      verificationNotes: possibleDuplicate ? `Possible duplicate of organisation ${possibleDuplicate.id}` : null,
      termsAcceptedAt: new Date(),
      termsVersion: TERMS_VERSION,
      memberships: { create: { userId: session.user.id, roleId: ownerRoleId } },
      ...(input.type === "UNIVERSITY" ? { universityProfile: { create: {} } } : {}),
    },
  });

  await withOrg(org.id, session.user.id, async (tx) => {
    await seedOrganisationDefaults(tx, org.id, session.user.id);
    if (plan && plan.trialDays > 0) {
      const now = new Date();
      const end = new Date(now.getTime() + plan.trialDays * 86400_000);
      await tx.subscription.create({
        data: { organisationId: org.id, planId: plan.id, status: "TRIALING", provider: "internal", currentPeriodStart: now, currentPeriodEnd: end, trialEndsAt: end },
      });
      const credits = await tx.planEntitlement.findUnique({ where: { planId_key: { planId: plan.id, key: "trial_interview_credits" } } });
      if (credits && Number(credits.value) > 0) {
        await grant(tx, { organisationId: org.id }, Number(credits.value), "GRANT_SUBSCRIPTION", `trial:${org.id}`, { expiresAt: end, reason: "trial" });
      }
    }
    await audit({ organisationId: org.id, actorUserId: session.user.id, action: "organisation.created", targetType: "Organisation", targetId: org.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { type: input.type, plan: plan?.key ?? null } }, tx);
  });
  await prisma.retentionPolicy.createMany({ data: DEFAULT_RETENTION.map((r) => ({ ...r, organisationId: org.id })) });
  await prisma.session.update({ where: { id: session.id }, data: { activeOrgId: org.id } });
  await sendEmail("organisationWelcome", { name: session.user.firstName ?? "there", org: org.name, url: `${env().APP_URL}/w/${org.slug}` }, { to: session.user.email, userId: session.user.id, organisationId: org.id });
  return org;
}

export const updateOrgSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  website: z.string().trim().url().max(300).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  sizeBand: z.string().max(20).nullable().optional(),
  country: z.string().trim().length(2).toUpperCase().nullable().optional(),
  timezone: z.string().max(60).optional(),
  defaultLocale: z.string().max(10).optional(),
  description: z.string().max(4000).nullable().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  billingEmail: z.string().email().nullable().optional(),
  settings: z
    .object({
      requireMfa: z.boolean().optional(),
      defaultInvitationDays: z.number().int().min(1).max(60).optional(),
      notifyOnApplication: z.boolean().optional(),
      candidateFeedbackDefault: z.enum(["NONE", "APPROVED_ONLY"]).optional(),
    })
    .optional(),
});

export async function updateOrganisation(ctx: OrgContext, input: z.infer<typeof updateOrgSchema>, meta: RequestMeta) {
  ctx.assert("org.manage");
  const current = await prisma.organisation.findUniqueOrThrow({ where: { id: ctx.org.id } });
  const settings = input.settings ? { ...(current.settings as object), ...input.settings } : undefined;
  const { settings: _s, ...rest } = input;
  void _s;
  const org = await prisma.organisation.update({ where: { id: ctx.org.id }, data: { ...rest, ...(settings ? { settings } : {}) } });
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "organisation.updated", targetType: "Organisation", targetId: ctx.org.id, ip: meta.ip, metadata: { fields: Object.keys(input) } });
  return org;
}

// ─────────────── Members & invitations ───────────────

export async function listMembers(ctx: OrgContext) {
  ctx.assert("members.view");
  const [members, invitations] = await Promise.all([
    prisma.organisationMembership.findMany({
      where: { organisationId: ctx.org.id, status: "ACTIVE" },
      include: { user: { select: { id: true, email: true, mfaEnabledAt: true, lastLoginAt: true, profile: { select: { firstName: true, lastName: true } } } }, role: true },
      orderBy: { createdAt: "asc" },
    }),
    ctx.can("members.invite")
      ? prisma.invitation.findMany({ where: { organisationId: ctx.org.id, status: "PENDING" }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
  ]);
  return {
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      name: [m.user.profile?.firstName, m.user.profile?.lastName].filter(Boolean).join(" "),
      roleKey: m.role.key,
      roleName: m.role.name,
      title: m.title,
      mfaEnabled: !!m.user.mfaEnabledAt,
      lastLoginAt: m.user.lastLoginAt,
      joinedAt: m.createdAt,
    })),
    invitations: invitations.map((i) => ({ id: i.id, email: i.email, roleKey: i.roleKey, expiresAt: i.expiresAt, createdAt: i.createdAt, expired: i.expiresAt < new Date() })),
    assignableRoles: assignableRoles(ctx.roleKey, ctx.org.type).map((k) => ({ key: k, name: ORG_ROLES[k].name, description: ORG_ROLES[k].description })),
  };
}

export const inviteSchema = z.object({
  invites: z.array(z.object({ email: z.string().trim().toLowerCase().email(), roleKey: z.string() })).min(1).max(50),
});

export async function inviteMembers(ctx: OrgContext, input: z.infer<typeof inviteSchema>, meta: RequestMeta) {
  ctx.assert("members.invite");
  const allowed = new Set<string>(assignableRoles(ctx.roleKey, ctx.org.type));
  for (const inv of input.invites) {
    if (!isOrgRoleKey(inv.roleKey) || !allowed.has(inv.roleKey)) throw forbidden(`You cannot assign the role ${inv.roleKey}`);
  }
  const ent = await getEntitlements(ctx.org.id);
  const used = await seatsUsed(ctx.org.id);
  const unique = [...new Map(input.invites.map((i) => [i.email, i])).values()];
  if (used + unique.length > ent.seats) {
    throw new AppError("PAYMENT_REQUIRED", `Your plan includes ${ent.seats} seats (${used} in use or invited). Upgrade to add more team members.`);
  }
  const inviter = [ctx.session.user.firstName, ctx.session.user.lastName].filter(Boolean).join(" ") || ctx.session.user.email;
  const days = 7;
  const results: { email: string; status: "invited" | "already_member" }[] = [];
  for (const inv of unique) {
    const existingMember = await prisma.organisationMembership.findFirst({ where: { organisationId: ctx.org.id, status: "ACTIVE", user: { email: inv.email } } });
    if (existingMember) {
      results.push({ email: inv.email, status: "already_member" });
      continue;
    }
    // Supersede previous pending invites for the same email.
    await prisma.invitation.updateMany({ where: { organisationId: ctx.org.id, email: inv.email, status: "PENDING" }, data: { status: "REVOKED" } });
    const token = randomToken();
    const invitation = await prisma.invitation.create({
      data: { organisationId: ctx.org.id, email: inv.email, roleKey: inv.roleKey, tokenHash: sha256(token), invitedById: ctx.userId, expiresAt: new Date(Date.now() + days * 86400_000) },
    });
    await sendEmail(
      "hrInvitation",
      { inviter, org: ctx.org.name, role: ORG_ROLES[inv.roleKey as keyof typeof ORG_ROLES].name, url: `${env().APP_URL}/accept-invite?token=${token}` },
      { to: inv.email, organisationId: ctx.org.id, idempotencyKey: `invite:${invitation.id}` },
    );
    await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "member.invited", targetType: "Invitation", targetId: invitation.id, ip: meta.ip, metadata: { email: inv.email, role: inv.roleKey } });
    results.push({ email: inv.email, status: "invited" });
  }
  return { results };
}

export async function revokeInvitation(ctx: OrgContext, invitationId: string, meta: RequestMeta) {
  ctx.assert("members.invite");
  const res = await prisma.invitation.updateMany({ where: { id: invitationId, organisationId: ctx.org.id, status: "PENDING" }, data: { status: "REVOKED" } });
  if (res.count === 0) throw notFound("Invitation");
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "member.invitation_revoked", targetType: "Invitation", targetId: invitationId, ip: meta.ip });
}

/** Preview an invitation (public, by token) — reveals only the org name and role. */
export async function previewInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { organisation: { select: { name: true, slug: true } } } });
  if (!inv || inv.status !== "PENDING" || inv.expiresAt < new Date()) return null;
  return { organisation: inv.organisation.name, role: ORG_ROLES[inv.roleKey as keyof typeof ORG_ROLES]?.name ?? inv.roleKey, email: inv.email };
}

export async function acceptInvitation(session: SessionInfo, token: string, meta: RequestMeta) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { organisation: true } });
  if (!inv || inv.status !== "PENDING") throw badRequest("This invitation is invalid or has already been used");
  if (inv.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: "EXPIRED" } });
    throw badRequest("This invitation has expired. Ask your administrator to send a new one.");
  }
  // The invitation is bound to an email address; it cannot be redeemed by another account.
  if (inv.email.toLowerCase() !== session.user.email.toLowerCase()) {
    await audit({ organisationId: inv.organisationId, actorUserId: session.user.id, action: "member.invitation_email_mismatch", result: "DENIED", ip: meta.ip });
    throw forbidden("This invitation was sent to a different email address. Sign in with that address to accept it.");
  }
  if (inv.organisation.status !== "ACTIVE") throw forbidden("This organisation is not active");
  const roleId = await systemRoleId(inv.roleKey);
  await prisma.$transaction(async (tx) => {
    // Single-use: the conditional update fails if another request consumed it first.
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, status: "PENDING" }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedById: session.user.id } });
    if (claimed.count !== 1) throw badRequest("This invitation has already been used");
    await tx.organisationMembership.upsert({
      where: { organisationId_userId: { organisationId: inv.organisationId, userId: session.user.id } },
      create: { organisationId: inv.organisationId, userId: session.user.id, roleId },
      update: { roleId, status: "ACTIVE" },
    });
    // Accepting an emailed invite proves control of the address.
    if (!session.user.emailVerifiedAt) await tx.user.update({ where: { id: session.user.id }, data: { emailVerifiedAt: new Date() } });
    await tx.session.update({ where: { id: session.id }, data: { activeOrgId: inv.organisationId } });
  });
  await audit({ organisationId: inv.organisationId, actorUserId: session.user.id, action: "member.joined", targetType: "Invitation", targetId: inv.id, ip: meta.ip, metadata: { role: inv.roleKey } });
  return { slug: inv.organisation.slug };
}

export async function changeMemberRole(ctx: OrgContext, membershipId: string, roleKey: string, meta: RequestMeta) {
  ctx.assert("members.manage");
  const m = await prisma.organisationMembership.findFirst({ where: { id: membershipId, organisationId: ctx.org.id, status: "ACTIVE" }, include: { role: true } });
  if (!m) throw notFound("Member");
  const allowed = new Set<string>(assignableRoles(ctx.roleKey, ctx.org.type));
  if (!allowed.has(roleKey)) throw forbidden(`You cannot assign the role ${roleKey}`);
  // Non-owners can never modify an owner.
  if (m.role.key === "OWNER" && ctx.roleKey !== "OWNER") throw forbidden();
  if (m.role.key === "OWNER" && roleKey !== "OWNER") await assertNotLastOwner(ctx.org.id, m.id);
  if (m.userId === ctx.userId && roleKey !== m.role.key && ctx.roleKey !== "OWNER") throw forbidden("You cannot change your own role");
  await prisma.organisationMembership.update({ where: { id: m.id }, data: { roleId: await systemRoleId(roleKey) } });
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "member.role_changed", targetType: "OrganisationMembership", targetId: m.id, ip: meta.ip, metadata: { from: m.role.key, to: roleKey } });
}

async function assertNotLastOwner(organisationId: string, membershipId: string) {
  const owners = await prisma.organisationMembership.count({ where: { organisationId, status: "ACTIVE", role: { key: "OWNER" }, id: { not: membershipId } } });
  if (owners === 0) throw conflict("An organisation must keep at least one owner. Transfer ownership first.");
}

export async function removeMember(ctx: OrgContext, membershipId: string, meta: RequestMeta) {
  ctx.assert("members.manage");
  const m = await prisma.organisationMembership.findFirst({ where: { id: membershipId, organisationId: ctx.org.id, status: "ACTIVE" }, include: { role: true } });
  if (!m) throw notFound("Member");
  if (m.role.key === "OWNER") {
    if (ctx.roleKey !== "OWNER") throw forbidden();
    await assertNotLastOwner(ctx.org.id, m.id);
  }
  await prisma.organisationMembership.update({ where: { id: m.id }, data: { status: "REMOVED" } });
  // Drop the member's job assignments and any session pointing at this org.
  await withOrg(ctx.org.id, ctx.userId, (tx) => tx.jobAssignment.deleteMany({ where: { organisationId: ctx.org.id, userId: m.userId } }));
  await prisma.session.updateMany({ where: { userId: m.userId, activeOrgId: ctx.org.id }, data: { activeOrgId: null } });
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "member.removed", targetType: "OrganisationMembership", targetId: m.id, ip: meta.ip });
}

export async function transferOwnership(ctx: OrgContext, membershipId: string, meta: RequestMeta) {
  ctx.assert("org.transfer");
  const target = await prisma.organisationMembership.findFirst({ where: { id: membershipId, organisationId: ctx.org.id, status: "ACTIVE" } });
  if (!target || target.userId === ctx.userId) throw notFound("Member");
  const ownerRole = await systemRoleId("OWNER");
  const demoteTo = await systemRoleId(ctx.org.type === "UNIVERSITY" ? "PLACEMENT_ADMIN" : "HR_ADMIN");
  await prisma.$transaction([
    prisma.organisationMembership.update({ where: { id: target.id }, data: { roleId: ownerRole } }),
    prisma.organisationMembership.update({ where: { id: ctx.membershipId }, data: { roleId: demoteTo } }),
  ]);
  await audit({ organisationId: ctx.org.id, actorUserId: ctx.userId, action: "organisation.ownership_transferred", targetType: "OrganisationMembership", targetId: target.id, ip: meta.ip });
}

export async function switchActiveOrganisation(session: SessionInfo, orgRef: string) {
  const m = await prisma.organisationMembership.findFirst({ where: { userId: session.user.id, status: "ACTIVE", organisation: { OR: [{ id: orgRef }, { slug: orgRef }] } }, include: { organisation: true } });
  if (!m) throw notFound("Organisation");
  await prisma.session.update({ where: { id: session.id }, data: { activeOrgId: m.organisationId } });
  return { slug: m.organisation.slug };
}

export async function listMyOrganisations(userId: string) {
  const ms = await prisma.organisationMembership.findMany({ where: { userId, status: "ACTIVE", organisation: { status: { in: ["ACTIVE", "SUSPENDED", "PENDING_VERIFICATION"] } } }, include: { organisation: true, role: true }, orderBy: { createdAt: "asc" } });
  return ms.map((m) => ({ id: m.organisation.id, slug: m.organisation.slug, name: m.organisation.name, type: m.organisation.type, status: m.organisation.status, role: m.role.key }));
}

// ─────────────── Departments ───────────────

export async function listDepartments(ctx: OrgContext) {
  return withOrg(ctx.org.id, ctx.userId, (tx) => tx.department.findMany({ where: { organisationId: ctx.org.id }, orderBy: { name: "asc" } }));
}

export async function createDepartment(ctx: OrgContext, name: string) {
  ctx.assert("departments.manage");
  return withOrg(ctx.org.id, ctx.userId, (tx) => tx.department.create({ data: { organisationId: ctx.org.id, name: name.trim() } }));
}

export async function deleteDepartment(ctx: OrgContext, id: string) {
  ctx.assert("departments.manage");
  return withOrg(ctx.org.id, ctx.userId, async (tx) => {
    const used = await tx.job.count({ where: { departmentId: id, organisationId: ctx.org.id } });
    if (used) throw conflict("Department has vacancies. Reassign them first.");
    const r = await tx.department.deleteMany({ where: { id, organisationId: ctx.org.id } });
    if (!r.count) throw notFound("Department");
  });
}

/** Used by the platform admin & token flows. */
export async function getOrganisationSystem(id: string) {
  return withSystem("org lookup", (tx) => tx.organisation.findUnique({ where: { id } }));
}
