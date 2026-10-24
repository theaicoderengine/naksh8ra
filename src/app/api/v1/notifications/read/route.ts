import { z } from "zod";
import { route } from "@/server/http/route";
import { prisma } from "@/server/db/client";

export const POST = route({ auth: "session", body: z.object({ ids: z.array(z.string()).max(100).optional() }) }, async ({ session, body }) => {
  const r = await prisma.notification.updateMany({ where: { userId: session.user.id, readAt: null, ...(body.ids ? { id: { in: body.ids } } : {}) }, data: { readAt: new Date() } });
  return { updated: r.count };
});
