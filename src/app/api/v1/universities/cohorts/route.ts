import { route } from "@/server/http/route";
import { cohortSchema, createCohort, listCohorts } from "@/server/services/universities";

export const GET = route({ auth: "org", permission: "university.students.view" }, async ({ org }) => listCohorts(org));
export const POST = route({ auth: "org", permission: "university.manage", body: cohortSchema }, async ({ org, body, meta }) => createCohort(org, body, meta));
