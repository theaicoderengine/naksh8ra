import { route } from "@/server/http/route";
import { auditQuery, listAuditEvents } from "@/server/services/platform";

export const GET = route({ auth: "org", permission: "audit.view", query: auditQuery }, async ({ org, query }) => listAuditEvents(query, org.org.id));
