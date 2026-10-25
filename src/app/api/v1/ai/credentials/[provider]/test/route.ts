import { route } from "@/server/http/route";
import { testOrgCredential } from "@/server/services/ai-settings";

export const POST = route({ auth: "org", permission: "ai.manage" }, async ({ org, params }) => testOrgCredential(org, params.provider));
