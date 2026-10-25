import { route } from "@/server/http/route";
import { grantsSchema, setAiGrants } from "@/server/services/ai-admin";
import { PERSONAL_SUBJECT } from "@/server/ai/catalog";

export const PUT = route({ auth: "session", platform: "platform.ai.manage", body: grantsSchema }, async ({ session, body, meta }) => setAiGrants(session, PERSONAL_SUBJECT, body, meta));
