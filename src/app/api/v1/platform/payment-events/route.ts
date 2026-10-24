import { z } from "zod";
import { route } from "@/server/http/route";
import { listPaymentEvents, retryPaymentEvents } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.billing.view", query: z.object({ status: z.string().max(20).optional() }) }, async ({ query }) => listPaymentEvents(query.status));
export const POST = route({ auth: "session", platform: "platform.billing.manage" }, async ({ session, meta }) => retryPaymentEvents(session, meta));
