import { z } from "zod";
import { route } from "@/server/http/route";
import { eraseCandidate } from "@/server/services/privacy";

export const POST = route({ auth: "org", permission: "retention.manage", body: z.object({ reason: z.string().trim().min(5).max(1000), confirm: z.literal(true) }) }, async ({ org, params, body, meta }) => eraseCandidate(org, params.id, body.reason, meta));
