import { route } from "@/server/http/route";
import { listPlansAdmin, planSchema, upsertPlan } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.billing.view" }, async () => listPlansAdmin());
export const POST = route({ auth: "session", platform: "platform.billing.manage", body: planSchema }, async ({ body, session, meta }) => upsertPlan(body, session, meta));
