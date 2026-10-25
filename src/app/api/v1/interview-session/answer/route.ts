import { route } from "@/server/http/route";
import { interviewAccess, candidateSafe } from "@/server/http/interview-access";
import { submitStructuredAnswer } from "@/server/services/interviews";
import { readMultipart } from "@/server/http/helpers";

export const POST = route({ auth: "optional", rawBody: true }, async ({ req, session }) => {
  const access = await interviewAccess(req, session);
  const { fields, file } = await readMultipart(req, 25 * 1024 * 1024);
  return candidateSafe(submitStructuredAnswer(access, {
    position: Number(fields.position),
    audio: file ? { buffer: file.buffer, fileName: file.fileName } : null,
    text: fields.text ?? null,
    durationMs: fields.durationMs ? Number(fields.durationMs) : null,
    retake: fields.retake === "true",
    idempotencyKey: fields.idempotencyKey ?? null,
  }));
});
