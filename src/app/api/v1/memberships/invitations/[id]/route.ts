import { route } from "@/server/http/route";
import { revokeInvitation } from "@/server/services/organisations";

export const DELETE = route({ auth: "org", permission: "members.invite" }, async ({ org, params, meta }) => {
  await revokeInvitation(org, params.id, meta);
  return { revoked: true };
});
