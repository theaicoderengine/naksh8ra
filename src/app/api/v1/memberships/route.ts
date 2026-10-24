import { route } from "@/server/http/route";
import { listMembers } from "@/server/services/organisations";

export const GET = route({ auth: "org", permission: "members.view" }, async ({ org }) => listMembers(org));
