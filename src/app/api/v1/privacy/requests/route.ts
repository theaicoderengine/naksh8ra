import { route } from "@/server/http/route";
import { createDataRequest, dsrSchema, listMyDataRequests } from "@/server/services/privacy";

export const GET = route({ auth: "session" }, async ({ session }) => listMyDataRequests(session.user.id));
export const POST = route({ auth: "verified", body: dsrSchema }, async ({ session, body, meta }) => createDataRequest(session.user.id, body, meta));
