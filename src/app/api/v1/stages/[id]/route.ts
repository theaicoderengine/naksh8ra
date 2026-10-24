import { z } from "zod";
import { route } from "@/server/http/route";
import { deleteStage, updateStage } from "@/server/services/applications";

export const PATCH = route({ auth: "org", permission: "interviews.configure", body: z.object({ name: z.string().trim().min(2).max(60).optional(), position: z.number().int().min(0).max(100).optional() }) }, async ({ org, params, body }) => updateStage(org, params.id, body));
export const DELETE = route({ auth: "org", permission: "interviews.configure" }, async ({ org, params }) => {
  await deleteStage(org, params.id);
  return { deleted: true };
});
