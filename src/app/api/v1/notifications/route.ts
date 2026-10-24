import { route } from "@/server/http/route";
import { prisma } from "@/server/db/client";

export const GET = route({ auth: "session" }, async ({ session }) => {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
  ]);
  return { items, unread };
});
