import { z } from "zod";
import { route } from "@/server/http/route";
import { listJobRuns } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.ops.view", query: z.object({ status: z.string().max(20).optional() }) }, async ({ query }) => listJobRuns(query.status));
