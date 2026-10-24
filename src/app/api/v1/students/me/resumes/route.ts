import { route } from "@/server/http/route";
import { listResumes, uploadResume } from "@/server/services/resumes";
import { readMultipart } from "@/server/http/helpers";
import { badRequest } from "@/server/errors";

export const GET = route({ auth: "session" }, async ({ session }) => listResumes(session.user.id));
export const POST = route({ auth: "verified", rateLimit: "upload", rawBody: true }, async ({ session, req }) => {
  const { fields, file } = await readMultipart(req);
  if (!file) throw badRequest("Attach a resume file (PDF, DOCX or TXT)");
  return uploadResume(session.user.id, file, fields.label);
});
