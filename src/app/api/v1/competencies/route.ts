import { route } from "@/server/http/route";
import { competencySchema, createCompetency, listCompetencies } from "@/server/services/templates";

export const GET = route({ auth: "org" }, async ({ org }) => listCompetencies(org));
export const POST = route({ auth: "org", permission: "interviews.configure", body: competencySchema }, async ({ org, body, meta }) => createCompetency(org, body, meta));
