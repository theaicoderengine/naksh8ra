import { route } from "@/server/http/route";
import { prisma } from "@/server/db/client";

export const GET = route({ auth: "org", permission: "support.approve_access" }, async ({ org }) => prisma.supportAccessGrant.findMany({ where: { organisationId: org.org.id }, orderBy: { createdAt: "desc" }, take: 50 }));
