import { route } from "@/server/http/route";
import { billingOverview } from "@/server/services/billing";

export const GET = route({ auth: "org", permission: "billing.view" }, async ({ org }) => billingOverview(org));
