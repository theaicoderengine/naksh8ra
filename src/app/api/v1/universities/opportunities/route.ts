import { route } from "@/server/http/route";
import { programmeOpportunities } from "@/server/services/universities";

export const GET = route({ auth: "org", permission: "university.students.view" }, async ({ org }) => programmeOpportunities(org));
