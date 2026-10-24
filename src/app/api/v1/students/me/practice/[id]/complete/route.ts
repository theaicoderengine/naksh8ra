import { route } from "@/server/http/route";
import { completePractice } from "@/server/services/practice";

export const POST = route({ auth: "session" }, async ({ session, params }) => completePractice(session.user.id, params.id));
