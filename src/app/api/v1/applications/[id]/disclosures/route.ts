import { z } from "zod";
import { route } from "@/server/http/route";
import { draftDisclosure } from "@/server/services/applications";

export const POST = route({ auth: "org", permission: "feedback.write", body: z.object({ body: z.string().trim().min(10).max(5000) }) }, async ({ org, params, body }) => draftDisclosure(org, params.id, body.body));
