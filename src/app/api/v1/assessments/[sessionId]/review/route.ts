import { route } from "@/server/http/route";
import { reviewAssessment, reviewSchema } from "@/server/services/assessments";

export const POST = route({ auth: "org", permission: "assessments.review", body: reviewSchema }, async ({ org, params, body, meta }) => reviewAssessment(org, params.sessionId, body, meta));
