import { route } from "@/server/http/route";
import { interviewAccess } from "@/server/http/interview-access";
import { consentSchema, recordConsent } from "@/server/services/interviews";

export const POST = route({ auth: "optional", body: consentSchema }, async ({ req, session, body, meta }) => recordConsent(await interviewAccess(req, session), body, meta));
