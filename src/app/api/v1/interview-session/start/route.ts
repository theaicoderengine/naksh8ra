import { route } from "@/server/http/route";
import { interviewAccess, candidateSafe } from "@/server/http/interview-access";
import { startInterview } from "@/server/services/interviews";

export const POST = route({ auth: "optional" }, async ({ req, session, meta }) => candidateSafe(startInterview(await interviewAccess(req, session), meta)));
