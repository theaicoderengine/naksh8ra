import { route } from "@/server/http/route";
import { deleteResume, resumeCorrectionSchema, updateResume } from "@/server/services/resumes";

export const PATCH = route({ auth: "session", body: resumeCorrectionSchema }, async ({ session, params, body }) => updateResume(session.user.id, params.id, body));
export const DELETE = route({ auth: "session" }, async ({ session, params }) => {
  await deleteResume(session.user.id, params.id);
  return { deleted: true };
});
