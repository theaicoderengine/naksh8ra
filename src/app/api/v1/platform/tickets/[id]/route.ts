import { z } from "zod";
import { route } from "@/server/http/route";
import { getTicket, replyTicket } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.tickets" }, async ({ params }) => getTicket(params.id, { admin: true }));
export const POST = route(
  { auth: "session", platform: "platform.tickets", body: z.object({ body: z.string().trim().min(1).max(10000), internal: z.boolean().default(false), status: z.enum(["OPEN", "PENDING", "RESOLVED", "CLOSED"]).optional() }) },
  async ({ params, body, session }) => replyTicket(params.id, session.user.id, body.body, { admin: true, internal: body.internal, status: body.status }),
);
