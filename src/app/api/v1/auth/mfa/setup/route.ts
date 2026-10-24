import { route } from "@/server/http/route";
import { beginMfaSetup } from "@/server/services/auth";

export const POST = route({ auth: "session" }, async ({ session }) => beginMfaSetup(session.user.id));
