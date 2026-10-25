import { route } from "@/server/http/route";
import { credentialSchema, removeOrgCredential, saveOrgCredential } from "@/server/services/ai-settings";

export const PUT = route({ auth: "org", permission: "ai.manage", body: credentialSchema }, async ({ org, params, body, meta }) => saveOrgCredential(org, params.provider, body, meta));
export const DELETE = route({ auth: "org", permission: "ai.manage" }, async ({ org, params, meta }) => removeOrgCredential(org, params.provider, meta));
