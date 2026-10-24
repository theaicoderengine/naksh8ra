import { z } from "zod";

/** Client-side form schemas (mirrors of server validators for instant feedback; the server re-validates). */
export const password = z
  .string()
  .min(12, "Use at least 12 characters")
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9\W_]/.test(p), "Include letters and at least one number or symbol");

export const registerForm = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: z.string().trim().min(1, "Required").max(80),
  email: z.string().trim().email("Enter a valid email"),
  password,
  companyName: z.string().trim().max(160).optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Please accept the terms and privacy notice" }) }),
  marketingOptIn: z.boolean().optional(),
});

export const loginForm = z.object({ email: z.string().trim().email("Enter a valid email"), password: z.string().min(1, "Required") });

export const contactForm = z.object({
  name: z.string().trim().min(2, "Required"),
  email: z.string().trim().email("Enter a valid email"),
  company: z.string().trim().optional(),
  topic: z.enum(["SALES", "SUPPORT", "PRIVACY", "PARTNERSHIP"]),
  message: z.string().trim().min(10, "Tell us a little more (10+ characters)"),
});
