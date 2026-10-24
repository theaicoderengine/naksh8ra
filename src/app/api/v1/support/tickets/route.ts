import { route } from "@/server/http/route";
import { createTicket, listTickets, ticketSchema } from "@/server/services/platform";
import { resolveOrgContext } from "@/server/auth/context";

export const GET = route({ auth: "session" }, async ({ session }) => listTickets({ requesterId: session.user.id }));
export const POST = route({ auth: "verified", body: ticketSchema }, async ({ session, body, req }) => {
  const ref = req.headers.get("x-atlas-org");
  const org = ref ? await resolveOrgContext(session, ref).catch(() => null) : null;
  return createTicket(session.user.id, org?.org.id ?? null, body);
});
