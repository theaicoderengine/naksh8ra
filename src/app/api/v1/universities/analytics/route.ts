import { route } from "@/server/http/route";
import { cohortAnalytics } from "@/server/services/universities";

export const GET = route({ auth: "org", permission: "analytics.view" }, async ({ org }) => cohortAnalytics(org));
