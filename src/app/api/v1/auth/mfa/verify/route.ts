import { z } from "zod";
import { route } from "@/server/http/route";
import { verifyMfaForSession } from "@/server/services/auth";

export const POST = route({ auth: "session", allowPartialMfa: true, body: z.object({ code: z.string().regex(/^\d{6}$/) }) }, async ({ body, session, meta }) => {
  await verifyMfaForSession(session.id, session.user.id, body.code, meta);
  return { verified: true };
});
