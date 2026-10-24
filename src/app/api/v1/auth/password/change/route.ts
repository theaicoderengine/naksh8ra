import { z } from "zod";
import { route } from "@/server/http/route";
import { changePassword } from "@/server/services/auth";

export const POST = route({ auth: "session", body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }) }, async ({ body, session, meta }) => {
  await changePassword(session.user.id, session.id, body.currentPassword, body.newPassword, meta);
  return { message: "Password changed. Other sessions were signed out." };
});
