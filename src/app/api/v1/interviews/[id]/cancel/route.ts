import { route } from "@/server/http/route";
import { cancelInterviewByHr } from "@/server/services/interviews";

export const POST = route({ auth: "org", permission: "interviews.invite" }, async ({ org, params, meta }) => {
  await cancelInterviewByHr(org, params.id, meta);
  return { cancelled: true };
});
