import { z } from "zod";
import { route } from "@/server/http/route";
import { changeMemberRole, removeMember } from "@/server/services/organisations";

export const PATCH = route({ auth: "org", permission: "members.manage", body: z.object({ roleKey: z.string().max(40) }) }, async ({ org, params, body, meta }) => {
  await changeMemberRole(org, params.id, body.roleKey, meta);
  return { updated: true };
});
export const DELETE = route({ auth: "org", permission: "members.manage" }, async ({ org, params, meta }) => {
  await removeMember(org, params.id, meta);
  return { removed: true };
});
