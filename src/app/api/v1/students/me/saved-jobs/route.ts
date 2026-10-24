import { route } from "@/server/http/route";
import { listSavedJobs } from "@/server/services/jobs";

export const GET = route({ auth: "session" }, async ({ session }) => listSavedJobs(session.user.id));
