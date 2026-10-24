import { route } from "@/server/http/route";
import { applySchema, applyToJob, listMyApplications } from "@/server/services/applications";

export const GET = route({ auth: "session" }, async ({ session }) => listMyApplications(session.user.id));
export const POST = route({ auth: "verified", body: applySchema }, async ({ session, body, meta }) => {
  const app = await applyToJob(session.user.id, body, meta);
  return { id: app.id, status: app.status };
});
