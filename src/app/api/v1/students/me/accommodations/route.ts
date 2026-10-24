import { route } from "@/server/http/route";
import { accommodationSchema, listMyAccommodations, requestAccommodation } from "@/server/services/students";

export const GET = route({ auth: "session" }, async ({ session }) => listMyAccommodations(session.user.id));
export const POST = route({ auth: "verified", body: accommodationSchema }, async ({ session, body, meta }) => requestAccommodation(session.user.id, body, meta));
