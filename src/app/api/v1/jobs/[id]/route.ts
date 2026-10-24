import { route } from "@/server/http/route";
import { getJob, updateJob, jobPatchSchema, type JobInput } from "@/server/services/jobs";

export const GET = route({ auth: "org" }, async ({ org, params }) => getJob(org, params.id));
export const PATCH = route({ auth: "org", permission: "jobs.edit", body: jobPatchSchema }, async ({ org, params, body, meta }) => updateJob(org, params.id, body as Partial<JobInput>, meta));
