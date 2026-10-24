import { route } from "@/server/http/route";
import { jobAnalytics } from "@/server/services/analytics";
import { notFound } from "@/server/errors";

export const GET = route({ auth: "org", permission: "analytics.view" }, async ({ org, params }) => {
  const r = await jobAnalytics(org, params.id);
  if (!r) throw notFound("Job");
  return r;
});
