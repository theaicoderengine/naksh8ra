import { route } from "@/server/http/route";
import { getRetention, retentionSchema, setRetention } from "@/server/services/privacy";

export const GET = route({ auth: "org", permission: "org.view" }, async ({ org }) => getRetention(org.org.id));
export const PUT = route({ auth: "org", permission: "retention.manage", body: retentionSchema }, async ({ org, body, meta }) => setRetention(org, body, meta));
