import { route } from "@/server/http/route";
import { getApplication } from "@/server/services/applications";

export const GET = route({ auth: "org" }, async ({ org, params }) => getApplication(org, params.id));
