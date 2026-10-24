import { z } from "zod";
import { route } from "@/server/http/route";
import { listPublicPlans } from "@/server/services/billing";

export const GET = route({ auth: "none", query: z.object({ audience: z.enum(["EMPLOYER", "UNIVERSITY", "STUDENT"]).default("EMPLOYER") }) }, async ({ query }) => listPublicPlans(query.audience));
