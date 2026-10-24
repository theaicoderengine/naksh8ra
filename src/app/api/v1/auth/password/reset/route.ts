import { z } from "zod";
import { route } from "@/server/http/route";
import { resetPassword } from "@/server/services/auth";

export const POST = route({ auth: "none", body: z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) }) }, async ({ body, meta }) => {
  await resetPassword(body.token, body.password, meta);
  return { message: "Password updated. Please sign in." };
});
