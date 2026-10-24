import { route } from "@/server/http/route";
import { platformOverview } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.orgs.view" }, async () => platformOverview());
