import { z } from "zod";
import { route } from "@/server/http/route";
import { prisma } from "@/server/db/client";

const schema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  locale: z.string().trim().max(10).optional(),
  timezone: z.string().trim().max(60).optional(),
});

/** Account-level profile (name, locale) for every user type. */
export const PATCH = route({ auth: "session", body: schema }, async ({ session, body }) => {
  const { locale, timezone, ...profile } = body;
  await prisma.user.update({ where: { id: session.user.id }, data: { locale, timezone, profile: { upsert: { create: { firstName: profile.firstName ?? "", lastName: profile.lastName ?? "", phone: profile.phone ?? null }, update: profile } } } });
  return { updated: true };
});
