import { route } from "@/server/http/route";
import { practiceBalance } from "@/server/services/practice";

export const GET = route({ auth: "session" }, async ({ session }) => practiceBalance(session.user.id));
