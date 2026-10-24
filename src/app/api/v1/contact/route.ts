import { z } from "zod";
import { route } from "@/server/http/route";
import { sendEmail } from "@/server/services/notifications";
import { env } from "@/server/env";

export const POST = route(
  { auth: "none", rateLimit: "contact", body: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email(), company: z.string().trim().max(160).optional(), topic: z.enum(["SALES", "SUPPORT", "PRIVACY", "PARTNERSHIP"]), message: z.string().trim().min(10).max(5000) }) },
  async ({ body }) => {
    await sendEmail("contactEnquiry", body, { to: env().APP_SUPPORT_EMAIL });
    return { message: "Thanks — we'll be in touch within two business days." };
  },
);
