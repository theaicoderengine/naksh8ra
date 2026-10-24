import { route } from "@/server/http/route";
import { adminRoleSchema, listPlatformAdmins, setPlatformRole } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.admins.manage" }, async () => listPlatformAdmins());
export const POST = route({ auth: "session", platform: "platform.admins.manage", body: adminRoleSchema }, async ({ body, session, meta }) => {
  await setPlatformRole(body, session, meta);
  return { updated: true };
});
