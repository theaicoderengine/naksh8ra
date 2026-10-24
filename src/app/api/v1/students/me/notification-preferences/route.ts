import { route } from "@/server/http/route";
import { getNotificationPrefs, prefsSchema, setNotificationPrefs } from "@/server/services/students";

export const GET = route({ auth: "session" }, async ({ session }) => getNotificationPrefs(session.user.id));
export const PUT = route({ auth: "session", body: prefsSchema }, async ({ session, body }) => setNotificationPrefs(session.user.id, body));
