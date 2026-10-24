import { route } from "@/server/http/route";
import { retryAssessment } from "@/server/services/assessments";

export const POST = route({ auth: "org", permission: "assessments.review" }, async ({ org, params, meta }) => {
  await retryAssessment(org, params.sessionId, meta);
  return { queued: true };
});
