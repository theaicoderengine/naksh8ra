import { route } from "@/server/http/route";
import { applicationListQuery, listApplications } from "@/server/services/applications";

export const GET = route({ auth: "org", query: applicationListQuery }, async ({ org, query }) => listApplications(org, query));
