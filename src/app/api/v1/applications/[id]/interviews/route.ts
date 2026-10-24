import { route } from "@/server/http/route";
import { inviteSchema, inviteToInterview } from "@/server/services/interviews";

export const POST = route({ auth: "org", permission: "interviews.invite", body: inviteSchema }, async ({ org, params, body, meta }) => inviteToInterview(org, params.id, body, meta));
