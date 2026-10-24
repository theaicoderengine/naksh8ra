import { route } from "@/server/http/route";
import { toggleSavedJob } from "@/server/services/jobs";

export const POST = route({ auth: "session" }, async ({ session, params }) => toggleSavedJob(session.user.id, params.id, true));
export const DELETE = route({ auth: "session" }, async ({ session, params }) => toggleSavedJob(session.user.id, params.id, false));
