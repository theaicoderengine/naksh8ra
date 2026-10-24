import { z } from "zod";
import { route } from "@/server/http/route";
import { withdrawApplication } from "@/server/services/applications";

export const POST = route({ auth: "session", body: z.object({ reason: z.string().max(1000).optional() }) }, async ({ session, params, body, meta }) => withdrawApplication(session.user.id, params.id, body.reason, meta));
