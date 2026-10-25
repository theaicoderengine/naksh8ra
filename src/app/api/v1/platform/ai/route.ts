import { route } from "@/server/http/route";
import { listOrgAiAccess } from "@/server/services/ai-admin";

export const GET = route({ auth: "session", platform: "platform.ai.view" }, async ({ req, session }) => listOrgAiAccess(session, req.nextUrl.searchParams.get("q")?.slice(0, 100) || undefined));
