import { route } from "@/server/http/route";
import { cohortMembers } from "@/server/services/universities";

export const GET = route({ auth: "org", permission: "university.students.view" }, async ({ org, params }) => cohortMembers(org, params.id));
