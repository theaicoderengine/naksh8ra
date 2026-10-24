import { route } from "@/server/http/route";
import { programmeSchema, saveProgramme } from "@/server/services/universities";

export const PATCH = route({ auth: "org", permission: "university.manage", body: programmeSchema }, async ({ org, params, body, meta }) => saveProgramme(org, params.id, body, meta));
