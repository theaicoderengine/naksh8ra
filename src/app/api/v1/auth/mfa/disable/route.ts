import { z } from "zod";
import { route } from "@/server/http/route";
import { disableMfa } from "@/server/services/auth";

export const POST = route({ auth: "session", body: z.object({ password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/) }) }, async ({ body, session, meta }) => {
  await disableMfa(session.user.id, body.password, body.code, meta);
  return { enabled: false };
});
