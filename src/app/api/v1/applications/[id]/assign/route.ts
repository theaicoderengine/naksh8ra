import { z } from "zod";
import { route } from "@/server/http/route";
import { assignApplication } from "@/server/services/applications";

export const POST = route({ auth: "org", permission: "applications.move", body: z.object({ userId: z.string().nullable() }) }, async ({ org, params, body }) => assignApplication(org, params.id, body.userId));
