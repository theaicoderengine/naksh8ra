import { route } from "@/server/http/route";
import { applicationListQuery, exportApplicationsCsv } from "@/server/services/applications";
import { csvResponse } from "@/server/http/helpers";

export const GET = route({ auth: "org", permission: "candidates.export", query: applicationListQuery }, async ({ org, query, meta }) =>
  csvResponse(await exportApplicationsCsv(org, query, meta), `applications-${new Date().toISOString().slice(0, 10)}.csv`),
);
