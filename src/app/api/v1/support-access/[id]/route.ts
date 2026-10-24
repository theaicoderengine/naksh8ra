import { z } from "zod";
import { route } from "@/server/http/route";
import { decideSupportAccess } from "@/server/services/platform";

export const POST = route({ auth: "org", permission: "support.approve_access", body: z.object({ approve: z.boolean() }) }, async ({ org, params, body, meta }) => decideSupportAccess(org.org.id, params.id, body.approve, org.userId, meta));
