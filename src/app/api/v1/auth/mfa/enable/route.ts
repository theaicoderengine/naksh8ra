import { z } from "zod";
import { route } from "@/server/http/route";
import { confirmMfaSetup } from "@/server/services/auth";

export const POST = route({ auth: "session", body: z.object({ code: z.string().regex(/^\d{6}$/) }) }, async ({ body, session, meta }) => {
  await confirmMfaSetup(session.user.id, session.id, body.code, meta);
  return { enabled: true };
});
