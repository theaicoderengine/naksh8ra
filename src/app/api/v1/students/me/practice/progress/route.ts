import { route } from "@/server/http/route";
import { practiceProgress } from "@/server/services/practice";

export const GET = route({ auth: "session" }, async ({ session }) => practiceProgress(session.user.id));
