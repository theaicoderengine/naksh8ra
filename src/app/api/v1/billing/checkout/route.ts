import { route } from "@/server/http/route";
import { checkoutSchema, createCheckout } from "@/server/services/billing";

export const POST = route({ auth: "org", permission: "billing.manage", body: checkoutSchema }, async ({ org, body }) => createCheckout(org, body));
