import { route } from "@/server/http/route";
import { listOrganisations, orgQuery } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.orgs.view", query: orgQuery }, async ({ query }) => listOrganisations(query));
