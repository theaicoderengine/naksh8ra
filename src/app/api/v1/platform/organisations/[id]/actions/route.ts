import { route } from "@/server/http/route";
import { organisationAction, orgActionSchema } from "@/server/services/platform";

export const POST = route({ auth: "session", platform: "platform.orgs.manage", body: orgActionSchema }, async ({ params, body, session, meta }) => organisationAction(params.id, body, session, meta));
