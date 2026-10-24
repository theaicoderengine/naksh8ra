import { route } from "@/server/http/route";
import { getPublicJob } from "@/server/services/jobs";

export const GET = route({ auth: "optional" }, async ({ session, params }) => getPublicJob(session?.user.id ?? null, params.id));
