import { route } from "@/server/http/route";
import { listOrgAccommodations } from "@/server/services/students";

export const GET = route({ auth: "org", permission: "candidates.view_all" }, async ({ org }) => listOrgAccommodations(org.org.id));
