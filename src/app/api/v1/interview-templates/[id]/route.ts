import { route } from "@/server/http/route";
import { archiveTemplate, getTemplate, saveTemplate, templateSchema } from "@/server/services/templates";

export const GET = route({ auth: "org" }, async ({ org, params }) => getTemplate(org, params.id));
export const PUT = route({ auth: "org", permission: "interviews.configure", body: templateSchema }, async ({ org, params, body, meta }) => saveTemplate(org, params.id, body, meta));
export const DELETE = route({ auth: "org", permission: "interviews.configure" }, async ({ org, params }) => {
  await archiveTemplate(org, params.id);
  return { archived: true };
});
