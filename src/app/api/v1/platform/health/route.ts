import { route } from "@/server/http/route";
import { providerHealth } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.ops.view" }, async () => providerHealth());
