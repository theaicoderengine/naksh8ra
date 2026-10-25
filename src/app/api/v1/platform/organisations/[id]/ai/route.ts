import { route } from "@/server/http/route";
import { getOrgAiAccess } from "@/server/services/ai-admin";

export const GET = route({ auth: "session", platform: "platform.ai.view" }, async ({ params, session, meta }) => getOrgAiAccess(session, params.id, meta));
