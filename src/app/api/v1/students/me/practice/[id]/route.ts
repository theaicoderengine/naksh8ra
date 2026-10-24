import { route } from "@/server/http/route";
import { getPractice } from "@/server/services/practice";

export const GET = route({ auth: "session" }, async ({ session, params }) => getPractice(session.user.id, params.id));
