import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/server/http/route";
import { login, emailSchema } from "@/server/services/auth";
import { withSessionCookie } from "@/server/http/helpers";
import { prisma } from "@/server/db/client";

export const POST = route({ auth: "none", body: z.object({ email: emailSchema, password: z.string().min(1).max(200) }) }, async ({ body, meta }) => {
  const r = await login(body.email, body.password, meta);
  const [memberships, student] = await Promise.all([
    prisma.organisationMembership.findMany({ where: { userId: r.user.id, status: "ACTIVE" }, include: { organisation: { select: { slug: true, type: true } } }, take: 1, orderBy: { createdAt: "asc" } }),
    prisma.studentProfile.findUnique({ where: { userId: r.user.id }, select: { id: true } }),
  ]);
  let next = "/onboarding";
  if (r.user.platformRole !== "NONE") next = "/admin";
  else if (memberships[0]) next = `/w/${memberships[0].organisation.slug}`;
  else if (student) next = "/student";
  // Platform administrators must enrol in MFA before using the admin console.
  if (!r.mfaRequired && r.user.platformRole !== "NONE") next = "/account/security?mfa=required";
  const res = NextResponse.json({ data: { mfaRequired: r.mfaRequired, emailVerified: !!r.user.emailVerifiedAt, next } });
  return withSessionCookie(res, r.token, r.expiresAt);
});
