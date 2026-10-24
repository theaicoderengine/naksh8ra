import { route } from "@/server/http/route";
import { inviteMembers, inviteSchema } from "@/server/services/organisations";

export const POST = route({ auth: "org", permission: "members.invite", body: inviteSchema }, async ({ org, body, meta }) => inviteMembers(org, body, meta));
