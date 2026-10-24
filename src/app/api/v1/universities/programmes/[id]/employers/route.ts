import { z } from "zod";
import { route } from "@/server/http/route";
import { inviteEmployerToProgramme } from "@/server/services/universities";

export const POST = route({ auth: "org", permission: "university.manage", body: z.object({ employerSlug: z.string().min(2).max(60) }) }, async ({ org, params, body, meta }) => inviteEmployerToProgramme(org, params.id, body.employerSlug, meta));
