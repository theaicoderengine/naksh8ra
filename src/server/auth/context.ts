import { prisma } from "../db/client";
import { forbidden, notFound, unauthenticated, AppError } from "../errors";
import { permissionsFor, type Permission, platformCan, type PlatformPermission } from "../rbac/permissions";
import type { SessionInfo } from "./session";

export type OrgContext = {
  session: SessionInfo;
  userId: string;
  org: { id: string; slug: string; name: string; type: "EMPLOYER" | "UNIVERSITY"; status: string; verificationStatus: string };
  membershipId: string;
  roleKey: string;
  permissions: Set<Permission>;
  can: (p: Permission) => boolean;
  assert: (p: Permission) => void;
};

/**
 * Resolve the organisation a request acts within. The identifier may come
 * from the URL or a header, but access is ONLY granted from the server-side
 * membership lookup for the authenticated user.
 */
export async function resolveOrgContext(session: SessionInfo, orgRef: string | null | undefined): Promise<OrgContext> {
  const ref = orgRef || session.activeOrgId;
  if (!ref) throw new AppError("BAD_REQUEST", "No active organisation selected");
  const membership = await prisma.organisationMembership.findFirst({
    where: {
      userId: session.user.id,
      status: "ACTIVE",
      organisation: { OR: [{ id: ref }, { slug: ref }] },
    },
    include: { organisation: true, role: true },
  });
  // Identical error for "doesn't exist" and "not a member" — no tenant enumeration.
  if (!membership) throw notFound("Organisation");
  const org = membership.organisation;
  if (org.status === "SUSPENDED") throw new AppError("FORBIDDEN", "This organisation is suspended. Contact support.");
  if (org.status === "CLOSED") throw notFound("Organisation");
  const settings = (org.settings ?? {}) as { requireMfa?: boolean };
  if (settings.requireMfa && !session.user.mfaEnabledAt) {
    throw new AppError("MFA_REQUIRED", "This organisation requires two-factor authentication. Enable it in your account security settings.");
  }
  const permissions = permissionsFor(membership.role.key);
  return {
    session,
    userId: session.user.id,
    org: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      type: org.type,
      status: org.status,
      verificationStatus: org.verificationStatus,
    },
    membershipId: membership.id,
    roleKey: membership.role.key,
    permissions,
    can: (p) => permissions.has(p),
    assert: (p) => {
      if (!permissions.has(p)) throw forbidden();
    },
  };
}

export function requireSession(session: SessionInfo | null): SessionInfo {
  if (!session) throw unauthenticated();
  return session;
}

export function requireVerified(session: SessionInfo) {
  if (!session.user.emailVerifiedAt) throw new AppError("FORBIDDEN", "Please verify your email address first");
}

export function requirePlatform(session: SessionInfo, p: PlatformPermission) {
  if (!platformCan(session.user.platformRole, p)) throw notFound();
  // Privileged operator access always requires MFA.
  if (!session.user.mfaEnabledAt || !session.mfaVerified) {
    throw new AppError("MFA_REQUIRED", "Multi-factor authentication is required for platform administration");
  }
}

/** Whether the user can see a given job (assignment-scoped roles). */
export async function canAccessJob(ctx: OrgContext, jobId: string, tx: { jobAssignment: typeof prisma.jobAssignment }) {
  if (ctx.can("jobs.view_all") || ctx.can("candidates.view_all")) return true;
  if (!ctx.can("jobs.view_assigned")) return false;
  const a = await tx.jobAssignment.findFirst({ where: { jobId, userId: ctx.userId, organisationId: ctx.org.id } });
  return !!a;
}
