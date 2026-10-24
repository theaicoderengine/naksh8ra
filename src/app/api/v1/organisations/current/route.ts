import { route } from "@/server/http/route";
import { prisma } from "@/server/db/client";
import { updateOrganisation, updateOrgSchema } from "@/server/services/organisations";
import { getEntitlements } from "@/server/billing/entitlements";

export const GET = route({ auth: "org", permission: "org.view" }, async ({ org }) => {
  const o = await prisma.organisation.findUniqueOrThrow({ where: { id: org.org.id }, select: { id: true, slug: true, name: true, legalName: true, type: true, status: true, verificationStatus: true, website: true, industry: true, sizeBand: true, country: true, timezone: true, defaultLocale: true, description: true, brandColor: true, billingEmail: true, settings: true, createdAt: true } });
  const ent = await getEntitlements(org.org.id);
  return { organisation: o, role: org.roleKey, permissions: [...org.permissions], features: [...ent.features] };
});
export const PATCH = route({ auth: "org", permission: "org.manage", body: updateOrgSchema }, async ({ org, body, meta }) => updateOrganisation(org, body, meta));
