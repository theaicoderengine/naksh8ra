import { route } from "@/server/http/route";
import { organisationDetail } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.orgs.view" }, async ({ params, session, meta }) => organisationDetail(params.id, session, meta));
