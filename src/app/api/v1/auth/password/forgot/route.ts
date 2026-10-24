import { z } from "zod";
import { route } from "@/server/http/route";
import { requestPasswordReset, emailSchema } from "@/server/services/auth";

export const POST = route({ auth: "none", body: z.object({ email: emailSchema }) }, async ({ body, meta }) => {
  await requestPasswordReset(body.email, meta);
  return { message: "If an account exists for this address, a reset link has been sent." };
});
