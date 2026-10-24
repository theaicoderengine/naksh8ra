import { z } from "zod";
import { route } from "@/server/http/route";
import { createStudentPracticeCheckout } from "@/server/services/billing";

export const POST = route({ auth: "verified", body: z.object({ packKey: z.string().max(60) }) }, async ({ session, body }) => createStudentPracticeCheckout(session, body.packKey));
