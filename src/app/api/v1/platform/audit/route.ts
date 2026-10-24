import { route } from "@/server/http/route";
import { auditQuery, listAuditEvents } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.security.view", query: auditQuery }, async ({ query }) => listAuditEvents(query));
