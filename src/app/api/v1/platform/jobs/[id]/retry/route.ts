import { route } from "@/server/http/route";
import { retryJobRun } from "@/server/services/platform";

export const POST = route({ auth: "session", platform: "platform.flags.manage" }, async ({ params, session, meta }) => {
  await retryJobRun(params.id, session, meta);
  return { queued: true };
});
