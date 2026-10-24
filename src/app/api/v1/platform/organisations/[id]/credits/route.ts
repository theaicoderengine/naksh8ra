import { route } from "@/server/http/route";
import { adjustOrgCredits, creditAdjustSchema } from "@/server/services/platform";

export const POST = route({ auth: "session", platform: "platform.billing.manage", body: creditAdjustSchema }, async ({ params, body, session, meta }) => adjustOrgCredits(params.id, body, session, meta));
