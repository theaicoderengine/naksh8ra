import { route } from "@/server/http/route";
import { interviewAccess } from "@/server/http/interview-access";
import { getCandidateState } from "@/server/services/interviews";

export const GET = route({ auth: "optional" }, async ({ req, session }) => getCandidateState(await interviewAccess(req, session)));
