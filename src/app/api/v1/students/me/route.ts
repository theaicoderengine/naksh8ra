import { route } from "@/server/http/route";
import { ensureStudentProfile, getStudentProfile, profileSchema, updateStudentProfile } from "@/server/services/students";

export const GET = route({ auth: "session" }, async ({ session }) => getStudentProfile(session.user.id));
export const PATCH = route({ auth: "verified", body: profileSchema }, async ({ session, body }) => {
  await ensureStudentProfile(session);
  await updateStudentProfile(session.user.id, body);
  return getStudentProfile(session.user.id);
});
