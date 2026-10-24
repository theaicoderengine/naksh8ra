import { route } from "@/server/http/route";
import { moveApplication, moveSchema } from "@/server/services/applications";

export const POST = route({ auth: "org", permission: "applications.move", body: moveSchema }, async ({ org, params, body, meta }) => moveApplication(org, params.id, body, meta));
