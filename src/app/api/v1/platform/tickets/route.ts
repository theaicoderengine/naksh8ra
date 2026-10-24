import { z } from "zod";
import { route } from "@/server/http/route";
import { listTickets } from "@/server/services/platform";

export const GET = route({ auth: "session", platform: "platform.tickets", query: z.object({ status: z.string().max(20).optional() }) }, async ({ query }) => listTickets({ status: query.status }));
