import { route } from "@/server/http/route";
import { interviewAccess, candidateSafe } from "@/server/http/interview-access";
import { conversationalTurn } from "@/server/services/interviews";
import { readMultipart } from "@/server/http/helpers";

export const POST = route({ auth: "optional", rawBody: true }, async ({ req, session }) => {
  const access = await interviewAccess(req, session);
  const { fields, file } = await readMultipart(req, 25 * 1024 * 1024);
  return candidateSafe(conversationalTurn(access, { audio: file ? { buffer: file.buffer, fileName: file.fileName } : null, text: fields.text ?? null, durationMs: fields.durationMs ? Number(fields.durationMs) : null }));
});
