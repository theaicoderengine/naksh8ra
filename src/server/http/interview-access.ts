import type { NextRequest } from "next/server";
import type { SessionInfo } from "../auth/session";
import { resolveInterviewAccess } from "../services/interviews";
import { rateLimit } from "../rate-limit";
import { AppError } from "../errors";

export async function interviewAccess(req: NextRequest, session: SessionInfo | null) {
  const token = req.headers.get("x-interview-token");
  const invitationId = req.nextUrl.searchParams.get("invitation");
  await rateLimit("interviewTurn", token ? `t:${token.slice(0, 16)}` : `i:${invitationId}`);
  return resolveInterviewAccess({ token, invitationId }, session);
}

const AI_CODES = new Set(["AI_ACCESS_DENIED", "AI_LIMIT_REACHED", "PROVIDER_NOT_CONFIGURED", "PROVIDER_QUOTA_EXCEEDED", "PROVIDER_ERROR"]);

/**
 * Candidates must not see the employer's AI configuration (which provider, keys, grants,
 * quotas or plan tiers). AI errors keep their code/status but get a neutral message; the
 * full detail is in the employer's AI request log.
 */
export async function candidateSafe<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof AppError && AI_CODES.has(err.code)) {
      throw new AppError(err.code, "The interview service is temporarily unavailable. Your answers so far are saved — please try again in a few minutes, or contact the employer.");
    }
    throw err;
  }
}
