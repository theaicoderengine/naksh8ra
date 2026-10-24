import { route } from "@/server/http/route";
import { removeCohortMember } from "@/server/services/universities";

export const DELETE = route({ auth: "org", permission: "university.manage" }, async ({ org, params, meta }) => {
  await removeCohortMember(org, params.id, meta);
  return { removed: true };
});
