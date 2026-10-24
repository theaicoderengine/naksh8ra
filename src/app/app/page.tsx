import { redirect } from "next/navigation";
import { requirePageSession } from "@/server/auth/page";
import { prisma } from "@/server/db/client";

/** Post-login router: sends each user to the right home. */
export default async function AppHome() {
  const s = await requirePageSession();
  if (!s.user.emailVerifiedAt) redirect("/verify-email/sent");
  const memberships = await prisma.organisationMembership.findMany({ where: { userId: s.user.id, status: "ACTIVE" }, include: { organisation: { select: { id: true, slug: true } } }, orderBy: { createdAt: "asc" } });
  const active = memberships.find((m) => m.organisationId === s.activeOrgId) ?? memberships[0];
  if (active) redirect(`/w/${active.organisation.slug}`);
  if (s.user.platformRole !== "NONE") redirect("/admin");
  if (s.user.isStudent) redirect("/student");
  redirect("/onboarding");
}
