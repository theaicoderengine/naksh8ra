import { route } from "@/server/http/route";
import { createJob, jobInputSchema, jobListQuery, listJobs } from "@/server/services/jobs";

export const GET = route({ auth: "org", query: jobListQuery }, async ({ org, query }) => listJobs(org, query));
export const POST = route({ auth: "org", permission: "jobs.create", body: jobInputSchema }, async ({ org, body, meta }) => createJob(org, body, meta));
