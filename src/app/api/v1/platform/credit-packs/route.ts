import { route } from "@/server/http/route";
import { packSchema, upsertPack } from "@/server/services/platform";

export const POST = route({ auth: "session", platform: "platform.billing.manage", body: packSchema }, async ({ body, session, meta }) => upsertPack(body, session, meta));
