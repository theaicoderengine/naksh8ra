import { route } from "@/server/http/route";
import { deleteDepartment } from "@/server/services/organisations";

export const DELETE = route({ auth: "org", permission: "departments.manage" }, async ({ org, params }) => {
  await deleteDepartment(org, params.id);
  return { deleted: true };
});
