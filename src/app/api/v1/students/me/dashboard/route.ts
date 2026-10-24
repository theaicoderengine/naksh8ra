import { route } from "@/server/http/route";
import { studentDashboard } from "@/server/services/students";

export const GET = route({ auth: "session" }, async ({ session }) => studentDashboard(session.user.id));
