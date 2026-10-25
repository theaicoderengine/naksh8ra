import { route } from "@/server/http/route";
import { getPersonalAiAccess } from "@/server/services/ai-admin";

export const GET = route({ auth: "session", platform: "platform.ai.view" }, async ({ session }) => getPersonalAiAccess(session));
