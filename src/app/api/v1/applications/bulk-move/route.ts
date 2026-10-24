import { route } from "@/server/http/route";
import { bulkMove, bulkMoveSchema } from "@/server/services/applications";

export const POST = route({ auth: "org", permission: "applications.move", body: bulkMoveSchema }, async ({ org, body, meta }) => bulkMove(org, body, meta));
