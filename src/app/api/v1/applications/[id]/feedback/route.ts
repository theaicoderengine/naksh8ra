import { route } from "@/server/http/route";
import { feedbackSchema, submitFeedback } from "@/server/services/applications";

export const POST = route({ auth: "org", permission: "feedback.write", body: feedbackSchema }, async ({ org, params, body, meta }) => submitFeedback(org, params.id, body, meta));
