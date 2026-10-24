import { cookies } from "next/headers";
import { prisma } from "../db/client";
import { randomToken, sha256 } from "./crypto";
import { env } from "../env";

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-atlas_session" : "atlas_session";

export type SessionUser = {
  id: string;
  email: string;
  status: string;
  platformRole: string;
  emailVerifiedAt: Date | null;
  mfaEnabledAt: Date | null;
  firstName: string | null;
  lastName: string | null;
  isStudent: boolean;
};

export type SessionInfo = {
  id: string;
  activeOrgId: string | null;
  mfaVerified: boolean;
  expiresAt: Date;
  user: SessionUser;
};

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null; mfaVerified?: boolean; privileged?: boolean },
) {
  const token = randomToken();
  const ttlHours = meta.privileged ? env().PRIVILEGED_SESSION_TTL_HOURS : env().SESSION_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      mfaVerified: meta.mfaVerified ?? false,
      expiresAt,
    },
  });
  return { token, session };
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
}

export async function resolveSessionToken(token: string | undefined | null): Promise<SessionInfo | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const row = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { profile: true, studentProfile: { select: { id: true } } } } },
  });
  if (!row || row.revokedAt || row.expiresAt < new Date()) return null;
  if (row.user.status !== "ACTIVE") return null;
  // Throttled sliding activity timestamp.
  if (Date.now() - row.lastSeenAt.getTime() > 5 * 60_000) {
    await prisma.session.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return {
    id: row.id,
    activeOrgId: row.activeOrgId,
    mfaVerified: row.mfaVerified,
    expiresAt: row.expiresAt,
    user: {
      id: row.user.id,
      email: row.user.email,
      status: row.user.status,
      platformRole: row.user.platformRole,
      emailVerifiedAt: row.user.emailVerifiedAt,
      mfaEnabledAt: row.user.mfaEnabledAt,
      firstName: row.user.profile?.firstName ?? null,
      lastName: row.user.profile?.lastName ?? null,
      isStudent: !!row.user.studentProfile,
    },
  };
}

export async function currentSession(): Promise<SessionInfo | null> {
  const jar = await cookies();
  return resolveSessionToken(jar.get(SESSION_COOKIE)?.value);
}

export async function revokeSession(sessionId: string, reason: string) {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
}

export async function revokeAllSessions(userId: string, reason: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}
