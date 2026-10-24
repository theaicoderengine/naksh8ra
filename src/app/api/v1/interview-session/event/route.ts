import { z } from "zod";
import { route } from "@/server/http/route";
import { interviewAccess } from "@/server/http/interview-access";
import { recordClientEvent } from "@/server/services/interviews";

export const POST = route({ auth: "optional", body: z.object({ type: z.string().max(40), data: z.record(z.unknown()).default({}), idempotencyKey: z.string().max(80).optional() }) }, async ({ req, session, body }) =>
  recordClientEvent(await interviewAccess(req, session), body.type, body.data, body.idempotencyKey),
);
