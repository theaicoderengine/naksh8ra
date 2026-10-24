import { route } from "@/server/http/route";
import { billingPortal } from "@/server/services/billing";

export const POST = route({ auth: "org", permission: "billing.manage" }, async ({ org }) => billingPortal(org));
