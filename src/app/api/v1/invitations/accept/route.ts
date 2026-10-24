import { z } from "zod";
import { route } from "@/server/http/route";
import { acceptInvitation } from "@/server/services/organisations";

export const POST = route({ auth: "session", body: z.object({ token: z.string().min(20).max(200) }) }, async ({ session, body, meta }) => acceptInvitation(session, body.token, meta));
