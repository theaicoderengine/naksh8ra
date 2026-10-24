import { route } from "@/server/http/route";
import { register, registerSchema } from "@/server/services/auth";

export const POST = route({ auth: "none", body: registerSchema }, async ({ body, meta }) => {
  await register(body, meta);
  return { message: "Check your inbox to verify your email address." };
});
