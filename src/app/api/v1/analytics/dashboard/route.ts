import { route } from "@/server/http/route";
import { hrDashboard } from "@/server/services/analytics";

export const GET = route({ auth: "org" }, async ({ org }) => hrDashboard(org));
