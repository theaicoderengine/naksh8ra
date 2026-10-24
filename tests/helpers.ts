import crypto from "node:crypto";
import { prisma } from "@/server/db/client";
import { hashPassword } from "@/server/auth/crypto";
import { createSession, resolveSessionToken, type SessionInfo } from "@/server/auth/session";
import { resolveOrgContext, type OrgContext } from "@/server/auth/context";
import { createOrganisation } from "@/server/services/organisations";
import { withOrg } from "@/server/db/tenant";
import { grant } from "@/server/billing/credits";
import type { RequestMeta } from "@/server/http/route";

export const meta: RequestMeta = { ip: "127.0.0.1", userAgent: "vitest", requestId: "test" };

export const uid = () => crypto.randomBytes(5).toString("hex");

let cachedHash: string | null = null;
export const PASSWORD = "Correct-horse-battery-9";

export async function makeUser(opts: { email?: string; verified?: boolean; platformRole?: "NONE" | "SUPPORT" | "BILLING_ADMIN" | "SUPER_ADMIN"; firstName?: string } = {}) {
  cachedHash ??= await hashPassword(PASSWORD);
  const email = opts.email ?? `user-${uid()}@test.example`;
  return prisma.user.create({
    data: {
      email,
      passwordHash: cachedHash,
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      platformRole: opts.platformRole ?? "NONE",
      profile: { create: { firstName: opts.firstName ?? "Test", lastName: "User" } },
    },
  });
}

export async function sessionFor(userId: string, mfaVerified = false): Promise<SessionInfo> {
  const { token } = await createSession(userId, { ip: "127.0.0.1", userAgent: "vitest", mfaVerified });
  const s = await resolveSessionToken(token);
  if (!s) throw new Error("session not resolvable");
  return s;
}

export async function makeOrg(opts: { type?: "EMPLOYER" | "UNIVERSITY"; credits?: number; name?: string } = {}) {
  const owner = await makeUser();
  const s = await sessionFor(owner.id);
  const org = await createOrganisation(s, { name: opts.name ?? `Org ${uid()}`, type: opts.type ?? "EMPLOYER", timezone: "UTC", acceptTerms: true }, meta);
  if (opts.credits) await withOrg(org.id, owner.id, (tx) => grant(tx, { organisationId: org.id }, opts.credits!, "GRANT_PURCHASE", `test:${uid()}`));
  const ctx = await resolveOrgContext(await sessionFor(owner.id), org.id);
  return { org, owner, ctx };
}

export async function addMember(orgId: string, roleKey: string) {
  const u = await makeUser();
  const role = await prisma.role.findFirstOrThrow({ where: { key: roleKey, organisationId: null } });
  await prisma.organisationMembership.create({ data: { organisationId: orgId, userId: u.id, roleId: role.id } });
  const ctx = await resolveOrgContext(await sessionFor(u.id), orgId);
  return { user: u, ctx };
}

export async function orgCtx(userId: string, orgId: string): Promise<OrgContext> {
  return resolveOrgContext(await sessionFor(userId), orgId);
}

/** Read a link token from the dev mailbox (console email provider stores bodies). */
export async function tokenFromEmail(to: string, re: RegExp) {
  const mails = await prisma.emailDelivery.findMany({ where: { toAddress: to.toLowerCase() }, orderBy: { createdAt: "desc" } });
  for (const d of mails) {
    const m = d.bodyText?.match(re);
    if (m) return m[1];
  }
  throw new Error(`no matching email to ${to}`);
}
