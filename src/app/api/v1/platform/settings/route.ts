import { route } from "@/server/http/route";
import { prisma } from "@/server/db/client";
import { setSetting, settingSchema } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.flags.manage" }, async () => prisma.platformSetting.findMany());
export const POST = route({ auth: "session", platform: "platform.flags.manage", body: settingSchema }, async ({ body, session, meta }) => setSetting(body, session, meta));
