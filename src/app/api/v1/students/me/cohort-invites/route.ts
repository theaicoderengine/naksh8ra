import { route } from "@/server/http/route";
import { listCohortInvites } from "@/server/services/students";

export const GET = route({ auth: "session" }, async ({ session }) => listCohortInvites(session.user.id));
