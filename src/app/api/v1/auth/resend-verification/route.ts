import { z } from "zod";
import { route } from "@/server/http/route";
import { resendVerification, emailSchema } from "@/server/services/auth";

export const POST = route({ auth: "none", body: z.object({ email: emailSchema }) }, async ({ body, meta }) => {
  await resendVerification(body.email, meta);
  return { message: "If an unverified account exists for this address, a new link has been sent." };
});
