import { route } from "@/server/http/route";
import { getInterviewForHr } from "@/server/services/interviews";

export const GET = route({ auth: "org" }, async ({ org, params }) => getInterviewForHr(org, params.id));
