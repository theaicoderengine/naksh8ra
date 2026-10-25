import { route } from "@/server/http/route";
import { grantsSchema, setAiGrants } from "@/server/services/ai-admin";
import { PERSONAL_SUBJECT } from "@/server/ai/catalog";
import { badRequest } from "@/server/errors";

export const PUT = route({ auth: "session", platform: "platform.ai.manage", body: grantsSchema }, async ({ params, session, body, meta }) => {
  if (params.id === PERSONAL_SUBJECT) throw badRequest("Use the personal-accounts endpoint");
  return setAiGrants(session, params.id, body, meta);
});
