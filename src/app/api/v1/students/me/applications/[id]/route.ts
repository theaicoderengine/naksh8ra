import { route } from "@/server/http/route";
import { getMyApplication } from "@/server/services/applications";

export const GET = route({ auth: "session" }, async ({ session, params }) => getMyApplication(session.user.id, params.id));
