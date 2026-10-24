import { route } from "@/server/http/route";
import { listPractice, startPractice, startPracticeSchema } from "@/server/services/practice";

export const GET = route({ auth: "session" }, async ({ session }) => listPractice(session.user.id));
export const POST = route({ auth: "verified", rateLimit: "ai", body: startPracticeSchema }, async ({ session, body }) => startPractice(session.user.id, body));
