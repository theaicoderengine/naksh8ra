import { z } from "zod";
import { route } from "@/server/http/route";
import { changeJobStatus } from "@/server/services/jobs";

export const POST = route(
  { auth: "org", permission: "jobs.publish", body: z.object({ action: z.enum(["publish", "pause", "resume", "close", "reopen", "archive"]), confirmHumanReview: z.boolean().optional() }) },
  async ({ org, params, body, meta }) => changeJobStatus(org, params.id, body.action, { confirmHumanReview: body.confirmHumanReview }, meta),
);
