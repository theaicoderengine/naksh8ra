import { route } from "@/server/http/route";
import { discoverJobs, discoverQuery } from "@/server/services/jobs";

export const GET = route({ auth: "optional", query: discoverQuery }, async ({ session, query }) => discoverJobs(session?.user.id ?? null, query));
