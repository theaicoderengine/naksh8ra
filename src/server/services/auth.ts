import { z } from "zod";
import { prisma } from "../db/client";
import { hashPassword, verifyPassword, randomToken, sha256, encrypt, decrypt } from "../auth/crypto";
import { createSession, revokeAllSessions } from "../auth/session";
import { AppError, badRequest } from "../errors";
import { audit } from "../audit";
import { sendEmail } from "./notifications";
import { rateLimit, resetRateLimit } from "../rate-limit";
import { env } from "../env";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "../auth/totp";
import type { RequestMeta } from "../http/route";

export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9\W_]/.test(p), "Include letters and at least one number or symbol");

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  intent: z.enum(["EMPLOYER", "STUDENT", "UNIVERSITY", "CANDIDATE"]),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "You must accept the terms and privacy notice" }) }),
  marketingOptIn: z.boolean().optional(),
  companyName: z.string().trim().max(160).optional(),
});

export const TERMS_VERSION = "2026-10-01";
export const PRIVACY_VERSION = "2026-10-01";

const VERIFY_TTL_H = 24;
const RESET_TTL_H = 1;

async function issueToken(userId: string, purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET", ttlHours: number) {
  // Invalidate earlier unconsumed tokens of the same purpose (single active token).
  await prisma.authToken.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
  const token = randomToken();
  await prisma.authToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlHours * 3600_000) } });
  return token;
}

/**
 * Registration is enumeration-safe: the response is identical whether or not
 * the email already exists. Existing account holders get a notice email.
 */
export async function register(input: z.infer<typeof registerSchema>, meta: RequestMeta) {
  await rateLimit("register", meta.ip ?? "anon");
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    await sendEmail("securityAlert", {
      name: input.firstName,
      event: "Someone tried to create a new account with your email address",
      when: new Date().toUTCString(),
      url: `${env().APP_URL}/login`,
    }, { to: existing.email, userId: existing.id });
    return { ok: true };
  }
  const passwordHash = await hashPassword(input.password);
  const admins = env().PLATFORM_ADMIN_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      signupIntent: input.intent,
      platformRole: admins.includes(input.email) ? "SUPER_ADMIN" : "NONE",
      profile: { create: { firstName: input.firstName, lastName: input.lastName } },
      consents: {
        create: [
          { type: "TERMS", granted: true, noticeVersion: TERMS_VERSION, ipAddress: meta.ip, userAgent: meta.userAgent },
          { type: "PRIVACY_NOTICE", granted: true, noticeVersion: PRIVACY_VERSION, ipAddress: meta.ip, userAgent: meta.userAgent },
          { type: "MARKETING", granted: !!input.marketingOptIn, noticeVersion: PRIVACY_VERSION, ipAddress: meta.ip, userAgent: meta.userAgent },
        ],
      },
    },
  });
  const token = await issueToken(user.id, "EMAIL_VERIFICATION", VERIFY_TTL_H);
  await sendEmail("emailVerification", { name: input.firstName, url: `${env().APP_URL}/verify-email?token=${token}` }, { to: user.email, userId: user.id });
  await audit({ actorUserId: user.id, action: "user.registered", targetType: "User", targetId: user.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { intent: input.intent } });
  return { ok: true };
}

export async function verifyEmail(token: string) {
  const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { profile: true } } } });
  if (!row || row.purpose !== "EMAIL_VERIFICATION" || row.consumedAt || row.expiresAt < new Date()) {
    throw badRequest("This verification link is invalid or has expired");
  }
  await prisma.$transaction([
    prisma.authToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: row.user.emailVerifiedAt ?? new Date() } }),
  ]);
  await audit({ actorUserId: row.userId, action: "user.email_verified", targetType: "User", targetId: row.userId });
  return { userId: row.userId, intent: row.user.signupIntent };
}

export async function resendVerification(email: string, meta: RequestMeta) {
  await rateLimit("verifyResend", `${meta.ip}:${email}`);
  const user = await prisma.user.findUnique({ where: { email }, include: { profile: true } });
  if (user && !user.emailVerifiedAt) {
    const token = await issueToken(user.id, "EMAIL_VERIFICATION", VERIFY_TTL_H);
    await sendEmail("emailVerification", { name: user.profile?.firstName ?? "there", url: `${env().APP_URL}/verify-email?token=${token}` }, { to: user.email, userId: user.id });
  }
  return { ok: true };
}

const LOCK_THRESHOLD = 8;
const LOCK_MINUTES = 15;

export async function login(email: string, password: string, meta: RequestMeta) {
  await rateLimit("login", meta.ip ?? "anon");
  await rateLimit("loginAccount", email);
  const user = await prisma.user.findUnique({ where: { email } });
  const generic = new AppError("UNAUTHENTICATED", "Email or password is incorrect");
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await verifyPassword(password, null);
    throw generic;
  }
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok || user.status !== "ACTIVE") {
    if (user) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed, lockedUntil: failed >= LOCK_THRESHOLD ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      await audit({ actorUserId: user.id, action: "auth.login_failed", result: "FAILURE", ip: meta.ip, userAgent: meta.userAgent });
    }
    throw generic;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await resetRateLimit("loginAccount", email);
  const membership = await prisma.organisationMembership.findFirst({ where: { userId: user.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  // A fresh session is always issued on login (prevents session fixation).
  const { token, session } = await createSession(user.id, {
    ip: meta.ip,
    userAgent: meta.userAgent,
    mfaVerified: false,
    privileged: user.platformRole !== "NONE",
  });
  if (membership) await prisma.session.update({ where: { id: session.id }, data: { activeOrgId: membership.organisationId } });
  await audit({ actorUserId: user.id, action: "auth.login", ip: meta.ip, userAgent: meta.userAgent });
  return { token, expiresAt: session.expiresAt, mfaRequired: !!user.mfaEnabledAt, user };
}

export async function verifyMfaForSession(sessionId: string, userId: string, code: string, meta: RequestMeta) {
  await rateLimit("login", `mfa:${userId}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaSecret || !user.mfaEnabledAt) throw badRequest("MFA is not enabled");
  if (!verifyTotp(decrypt(user.mfaSecret), code)) {
    await audit({ actorUserId: userId, action: "auth.mfa_failed", result: "FAILURE", ip: meta.ip });
    throw new AppError("UNAUTHENTICATED", "Invalid code");
  }
  await prisma.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
  await audit({ actorUserId: userId, action: "auth.mfa_verified", ip: meta.ip });
}

export async function beginMfaSetup(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.mfaEnabledAt) throw badRequest("MFA is already enabled");
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { mfaSecret: encrypt(secret) } });
  return { secret, otpauthUrl: otpauthUrl(secret, user.email, env().APP_NAME) };
}

export async function confirmMfaSetup(userId: string, sessionId: string, code: string, meta: RequestMeta) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
  if (!user.mfaSecret) throw badRequest("Start MFA setup first");
  if (!verifyTotp(decrypt(user.mfaSecret), code)) throw badRequest("Invalid code — check your authenticator app's clock");
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabledAt: new Date() } });
  await prisma.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
  await audit({ actorUserId: userId, action: "auth.mfa_enabled", ip: meta.ip, userAgent: meta.userAgent });
  await sendEmail("securityAlert", { name: user.profile?.firstName ?? "there", event: "Two-factor authentication was enabled", when: new Date().toUTCString(), url: `${env().APP_URL}/account/security` }, { to: user.email, userId });
}

export async function disableMfa(userId: string, password: string, code: string, meta: RequestMeta) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
  if (!user.mfaEnabledAt || !user.mfaSecret) throw badRequest("MFA is not enabled");
  if (user.platformRole !== "NONE") throw new AppError("FORBIDDEN", "Platform administrators must keep MFA enabled");
  if (!(await verifyPassword(password, user.passwordHash)) || !verifyTotp(decrypt(user.mfaSecret), code)) {
    throw new AppError("UNAUTHENTICATED", "Password or code is incorrect");
  }
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabledAt: null, mfaSecret: null } });
  await audit({ actorUserId: userId, action: "auth.mfa_disabled", ip: meta.ip, userAgent: meta.userAgent });
  await sendEmail("securityAlert", { name: user.profile?.firstName ?? "there", event: "Two-factor authentication was disabled", when: new Date().toUTCString(), url: `${env().APP_URL}/account/security` }, { to: user.email, userId });
}

export async function requestPasswordReset(email: string, meta: RequestMeta) {
  await rateLimit("passwordReset", `${meta.ip}:${email}`);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.status === "ACTIVE") {
    const token = await issueToken(user.id, "PASSWORD_RESET", RESET_TTL_H);
    await sendEmail("passwordReset", { url: `${env().APP_URL}/reset-password?token=${token}` }, { to: user.email, userId: user.id });
    await audit({ actorUserId: user.id, action: "auth.password_reset_requested", ip: meta.ip });
  }
  return { ok: true }; // identical response either way
}

export async function resetPassword(token: string, newPassword: string, meta: RequestMeta) {
  passwordSchema.parse(newPassword);
  const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { profile: true } } } });
  if (!row || row.purpose !== "PASSWORD_RESET" || row.consumedAt || row.expiresAt < new Date()) {
    throw badRequest("This reset link is invalid or has expired");
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.authToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
    // A reset proves mailbox control, so it also verifies the email.
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null, emailVerifiedAt: row.user.emailVerifiedAt ?? new Date() } }),
  ]);
  await revokeAllSessions(row.userId, "password_reset");
  await audit({ actorUserId: row.userId, action: "auth.password_reset", ip: meta.ip, userAgent: meta.userAgent });
  await sendEmail("securityAlert", { name: row.user.profile?.firstName ?? "there", event: "Your password was changed", when: new Date().toUTCString(), url: `${env().APP_URL}/account/security` }, { to: row.user.email, userId: row.userId });
}

export async function changePassword(userId: string, sessionId: string, current: string, next: string, meta: RequestMeta) {
  passwordSchema.parse(next);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
  if (!(await verifyPassword(current, user.passwordHash))) throw new AppError("UNAUTHENTICATED", "Current password is incorrect");
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  await revokeAllSessions(userId, "password_changed", sessionId);
  await audit({ actorUserId: userId, action: "auth.password_changed", ip: meta.ip, userAgent: meta.userAgent });
  await sendEmail("securityAlert", { name: user.profile?.firstName ?? "there", event: "Your password was changed", when: new Date().toUTCString(), url: `${env().APP_URL}/account/security` }, { to: user.email, userId });
}
