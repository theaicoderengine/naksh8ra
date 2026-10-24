import { route } from "@/server/http/route";
import { interviewAccess } from "@/server/http/interview-access";
import { completeInterview } from "@/server/services/interviews";

export const POST = route({ auth: "optional" }, async ({ req, session }) => completeInterview(await interviewAccess(req, session)));
