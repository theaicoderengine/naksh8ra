import { route } from "@/server/http/route";
import { answerPractice } from "@/server/services/practice";
import { readMultipart } from "@/server/http/helpers";

export const POST = route({ auth: "session", rateLimit: "interviewTurn", rawBody: true }, async ({ session, params, req }) => {
  const { fields, file } = await readMultipart(req, 25 * 1024 * 1024);
  return answerPractice(session.user.id, params.id, { audio: file?.buffer ?? null, text: fields.text ?? null, durationMs: fields.durationMs ? Number(fields.durationMs) : null });
});
