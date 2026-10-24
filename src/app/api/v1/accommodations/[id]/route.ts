import { z } from "zod";
import { route } from "@/server/http/route";
import { respondAccommodation } from "@/server/services/students";

export const POST = route({ auth: "org", permission: "candidates.manage", body: z.object({ status: z.enum(["ACKNOWLEDGED", "GRANTED", "DECLINED"]), note: z.string().max(2000).optional() }) }, async ({ org, params, body }) =>
  respondAccommodation(org.org.id, org.userId, params.id, body.status, body.note),
);
