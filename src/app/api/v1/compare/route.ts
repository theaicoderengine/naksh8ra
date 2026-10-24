import { z } from "zod";
import { route } from "@/server/http/route";
import { compareCandidates } from "@/server/services/assessments";

export const GET = route({ auth: "org", query: z.object({ jobId: z.string(), ids: z.string().max(2000) }) }, async ({ org, query }) =>
  compareCandidates(org, query.jobId, query.ids.split(",").filter(Boolean).slice(0, 10)),
);
