import { z } from "zod";
import { route } from "@/server/http/route";
import { respondProgrammeInvite } from "@/server/services/universities";

export const POST = route({ auth: "org", permission: "jobs.publish", body: z.object({ accept: z.boolean() }) }, async ({ org, params, body, meta }) => {
  await respondProgrammeInvite(org, params.id, body.accept, meta);
  return { ok: true };
});
