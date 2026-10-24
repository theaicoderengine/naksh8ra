import { route } from "@/server/http/route";
import { listOrgDataRequests } from "@/server/services/privacy";

export const GET = route({ auth: "org", permission: "retention.manage" }, async ({ org }) => listOrgDataRequests(org));
