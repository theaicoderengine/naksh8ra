import { route } from "@/server/http/route";
import { addCandidateToJob, manualCandidateSchema } from "@/server/services/applications";

export const POST = route({ auth: "org", permission: "candidates.manage", body: manualCandidateSchema }, async ({ org, body, meta }) => addCandidateToJob(org, body, meta));
