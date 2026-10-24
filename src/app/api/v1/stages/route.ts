import { route } from "@/server/http/route";
import { createStage, listStages, stageSchema } from "@/server/services/applications";

export const GET = route({ auth: "org" }, async ({ org }) => listStages(org));
export const POST = route({ auth: "org", permission: "interviews.configure", body: stageSchema }, async ({ org, body }) => createStage(org, body));
