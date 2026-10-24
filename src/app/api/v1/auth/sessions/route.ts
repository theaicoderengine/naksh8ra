import { route } from "@/server/http/route";
import { prisma } from "@/server/db/client";

export const GET = route({ auth: "session" }, async ({ session }) => {
  const rows = await prisma.session.findMany({ where: { userId: session.user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true } });
  return rows.map((r) => ({ ...r, current: r.id === session.id }));
});
