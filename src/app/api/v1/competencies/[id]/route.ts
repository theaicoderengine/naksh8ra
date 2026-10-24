import { route } from "@/server/http/route";
import { archiveCompetency, competencySchema, updateCompetency } from "@/server/services/templates";

export const PATCH = route({ auth: "org", permission: "interviews.configure", body: competencySchema.partial() }, async ({ org, params, body, meta }) => updateCompetency(org, params.id, body, meta));
export const DELETE = route({ auth: "org", permission: "interviews.configure" }, async ({ org, params }) => {
  await archiveCompetency(org, params.id);
  return { archived: true };
});
