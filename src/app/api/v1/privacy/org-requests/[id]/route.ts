import { z } from "zod";
import { route } from "@/server/http/route";
import { resolveOrgDataRequest } from "@/server/services/privacy";

export const POST = route({ auth: "org", permission: "retention.manage", body: z.object({ status: z.enum(["COMPLETED", "REJECTED"]), note: z.string().trim().min(3).max(1000) }) }, async ({ org, params, body, meta }) => {
  await resolveOrgDataRequest(org, params.id, body.status, body.note, meta);
  return { ok: true };
});
