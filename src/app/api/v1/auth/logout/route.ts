import { NextResponse } from "next/server";
import { route } from "@/server/http/route";
import { revokeSession } from "@/server/auth/session";
import { clearSession } from "@/server/http/helpers";
import { audit } from "@/server/audit";

export const POST = route({ auth: "optional", allowPartialMfa: true }, async ({ session, meta }) => {
  if (session) {
    await revokeSession(session.id, "logout");
    await audit({ actorUserId: session.user.id, action: "auth.logout", ip: meta.ip });
  }
  return clearSession(NextResponse.json({ data: { ok: true } }));
});
