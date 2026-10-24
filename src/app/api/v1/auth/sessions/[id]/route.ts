import { route } from "@/server/http/route";
import { prisma } from "@/server/db/client";
import { notFound } from "@/server/errors";
import { audit } from "@/server/audit";

export const DELETE = route({ auth: "session" }, async ({ session, params, meta }) => {
  const r = await prisma.session.updateMany({ where: { id: params.id, userId: session.user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "user_revoked" } });
  if (!r.count) throw notFound("Session");
  await audit({ actorUserId: session.user.id, action: "auth.session_revoked", targetType: "Session", targetId: params.id, ip: meta.ip });
  return { revoked: true };
});
