import { route } from "@/server/http/route";
import { listDataRequestsAdmin } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.privacy.manage" }, async () => listDataRequestsAdmin());
