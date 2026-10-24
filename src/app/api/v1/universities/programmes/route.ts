import { route } from "@/server/http/route";
import { listProgrammes, programmeSchema, saveProgramme } from "@/server/services/universities";

export const GET = route({ auth: "org", permission: "university.students.view" }, async ({ org }) => listProgrammes(org));
export const POST = route({ auth: "org", permission: "university.manage", body: programmeSchema }, async ({ org, body, meta }) => saveProgramme(org, null, body, meta));
