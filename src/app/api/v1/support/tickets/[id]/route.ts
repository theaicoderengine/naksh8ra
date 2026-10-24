import { z } from "zod";
import { route } from "@/server/http/route";
import { getTicket, replyTicket } from "@/server/services/platform";

export const GET = route({ auth: "session" }, async ({ session, params }) => getTicket(params.id, { requesterId: session.user.id }));
export const POST = route({ auth: "session", body: z.object({ body: z.string().trim().min(1).max(10000) }) }, async ({ session, params, body }) =>
  replyTicket(params.id, session.user.id, body.body, { admin: false, requesterId: session.user.id }),
);
