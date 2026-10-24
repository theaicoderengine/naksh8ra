import { z } from "zod";
import { route } from "@/server/http/route";
import { requestSupportAccess } from "@/server/services/platform";

export const POST = route({ auth: "session", platform: "platform.tickets", body: z.object({ reason: z.string().min(5).max(1000) }) }, async ({ params, body, session, meta }) => requestSupportAccess(params.id, body.reason, session, meta));
