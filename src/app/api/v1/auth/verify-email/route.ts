import { z } from "zod";
import { route } from "@/server/http/route";
import { verifyEmail } from "@/server/services/auth";

export const POST = route({ auth: "none", body: z.object({ token: z.string().min(20).max(200) }) }, async ({ body }) => {
  const r = await verifyEmail(body.token);
  return { verified: true, intent: r.intent };
});
