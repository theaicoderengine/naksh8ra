import { route } from "@/server/http/route";
import { draftJobDescription, jdDraftSchema } from "@/server/services/jobs";

export const POST = route({ auth: "org", permission: "jobs.create", rateLimit: "ai", body: jdDraftSchema }, async ({ org, body }) => draftJobDescription(org, body));
