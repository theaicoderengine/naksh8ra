import { route } from "@/server/http/route";
import { prisma } from "@/server/db/client";
import { flagSchema, upsertFlag } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.flags.manage" }, async () => prisma.featureFlag.findMany({ orderBy: { key: "asc" } }));
export const POST = route({ auth: "session", platform: "platform.flags.manage", body: flagSchema }, async ({ body, session, meta }) => upsertFlag(body, session, meta));
