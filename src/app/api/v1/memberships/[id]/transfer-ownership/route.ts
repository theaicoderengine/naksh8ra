import { z } from "zod";
import { route } from "@/server/http/route";
import { transferOwnership } from "@/server/services/organisations";

export const POST = route({ auth: "org", permission: "org.transfer", body: z.object({ confirm: z.literal(true) }) }, async ({ org, params, meta }) => {
  await transferOwnership(org, params.id, meta);
  return { transferred: true };
});
