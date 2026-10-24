import { z } from "zod";
import { route } from "@/server/http/route";
import { respondCohortInvite } from "@/server/services/students";

export const POST = route({ auth: "verified", body: z.object({ accept: z.boolean() }) }, async ({ session, params, body, meta }) => respondCohortInvite(session.user.id, params.id, body.accept, meta));
