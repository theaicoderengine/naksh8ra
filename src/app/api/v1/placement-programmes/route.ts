import { route } from "@/server/http/route";
import { employerProgrammes } from "@/server/services/universities";

export const GET = route({ auth: "org", permission: "jobs.view_all" }, async ({ org }) => employerProgrammes(org));
