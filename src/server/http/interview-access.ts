import type { NextRequest } from "next/server";
import type { SessionInfo } from "../auth/session";
import { resolveInterviewAccess } from "../services/interviews";
import { rateLimit } from "../rate-limit";

export async function interviewAccess(req: NextRequest, session: SessionInfo | null) {
  const token = req.headers.get("x-interview-token");
  const invitationId = req.nextUrl.searchParams.get("invitation");
  await rateLimit("interviewTurn", token ? `t:${token.slice(0, 16)}` : `i:${invitationId}`);
  return resolveInterviewAccess({ token, invitationId }, session);
}
