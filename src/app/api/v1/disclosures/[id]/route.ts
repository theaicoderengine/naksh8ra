import { z } from "zod";
import { route } from "@/server/http/route";
import { setDisclosureStatus } from "@/server/services/applications";

export const POST = route({ auth: "org", permission: "feedback.disclose", body: z.object({ action: z.enum(["approve", "retract"]) }) }, async ({ org, params, body, meta }) => setDisclosureStatus(org, params.id, body.action, meta));
