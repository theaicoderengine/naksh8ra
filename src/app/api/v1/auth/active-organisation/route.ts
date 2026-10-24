import { z } from "zod";
import { route } from "@/server/http/route";
import { switchActiveOrganisation } from "@/server/services/organisations";

export const POST = route({ auth: "verified", body: z.object({ organisation: z.string().min(1).max(100) }) }, async ({ body, session }) => switchActiveOrganisation(session, body.organisation));
