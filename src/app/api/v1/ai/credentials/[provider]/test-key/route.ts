import { route } from "@/server/http/route";
import { testKeySchema, testNewKey } from "@/server/services/ai-settings";

export const POST = route({ auth: "org", permission: "ai.manage", body: testKeySchema }, async ({ org, params, body }) => testNewKey(org, params.provider, body));
