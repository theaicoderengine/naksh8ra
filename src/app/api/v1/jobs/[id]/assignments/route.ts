import { route } from "@/server/http/route";
import { assignmentSchema, setJobAssignments } from "@/server/services/jobs";

export const PUT = route({ auth: "org", permission: "jobs.edit", body: assignmentSchema }, async ({ org, params, body, meta }) => setJobAssignments(org, params.id, body, meta));
