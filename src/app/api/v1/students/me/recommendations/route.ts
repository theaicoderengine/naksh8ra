import { route } from "@/server/http/route";
import { recommendJobs } from "@/server/services/jobs";

export const GET = route({ auth: "session" }, async ({ session }) => recommendJobs(session.user.id, 10));
