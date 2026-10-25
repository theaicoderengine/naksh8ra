import { route } from "@/server/http/route";
import { getOrgAiSettings } from "@/server/services/ai-settings";

export const GET = route({ auth: "org", permission: "ai.manage" }, async ({ org }) => getOrgAiSettings(org));
