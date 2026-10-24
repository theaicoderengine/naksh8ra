import { route } from "@/server/http/route";
import { listTemplates, saveTemplate, templateSchema } from "@/server/services/templates";

export const GET = route({ auth: "org" }, async ({ org }) => listTemplates(org));
export const POST = route({ auth: "org", permission: "interviews.configure", body: templateSchema }, async ({ org, body, meta }) => saveTemplate(org, null, body, meta));
