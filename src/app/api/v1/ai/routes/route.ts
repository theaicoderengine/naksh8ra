import { route } from "@/server/http/route";
import { routesSchema, setOrgAiRoutes } from "@/server/services/ai-settings";

export const PUT = route({ auth: "org", permission: "ai.manage", body: routesSchema }, async ({ org, body, meta }) => setOrgAiRoutes(org, body, meta));
