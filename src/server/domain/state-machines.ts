import type { ApplicationStatus, InterviewSessionStatus, JobStatus, StageKind } from "@prisma/client";

// ─────────── Jobs ───────────
export type JobAction = "publish" | "pause" | "resume" | "close" | "reopen" | "archive";

const JOB_TRANSITIONS: Record<JobAction, { from: JobStatus[]; to: JobStatus }> = {
  publish: { from: ["DRAFT"], to: "PUBLISHED" },
  pause: { from: ["PUBLISHED"], to: "PAUSED" },
  resume: { from: ["PAUSED"], to: "PUBLISHED" },
  close: { from: ["PUBLISHED", "PAUSED"], to: "CLOSED" },
  reopen: { from: ["CLOSED"], to: "PUBLISHED" },
  archive: { from: ["DRAFT", "CLOSED"], to: "ARCHIVED" },
};

export function nextJobStatus(current: JobStatus, action: JobAction): JobStatus | null {
  const t = JOB_TRANSITIONS[action];
  return t && t.from.includes(current) ? t.to : null;
}

export function jobAcceptsApplications(job: { status: JobStatus; applicationDeadline: Date | null }, now = new Date()) {
  return job.status === "PUBLISHED" && (!job.applicationDeadline || job.applicationDeadline >= now);
}

// ─────────── Applications ───────────
/** Application status derives from the stage kind. */
export function statusForStageKind(kind: StageKind): ApplicationStatus {
  switch (kind) {
    case "NEW":
      return "SUBMITTED";
    case "REVIEW":
    case "SCREENING":
    case "FINAL_REVIEW":
      return "IN_REVIEW";
    case "AI_INTERVIEW_INVITED":
    case "AI_INTERVIEW_COMPLETED":
    case "HUMAN_INTERVIEW":
      return "INTERVIEWING";
    case "OFFER":
      return "OFFER";
    case "HIRED":
      return "HIRED";
    case "REJECTED":
      return "REJECTED";
    case "WITHDRAWN":
      return "WITHDRAWN";
  }
}

const TERMINAL_APP: ApplicationStatus[] = ["HIRED", "REJECTED", "WITHDRAWN"];

export function isTerminalApplication(s: ApplicationStatus) {
  return TERMINAL_APP.includes(s);
}

export type StageMoveCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validates an HR-initiated stage move. Organisations configure stages, but:
 * - withdrawn applications are final (only the applicant withdraws);
 * - HIRED / REJECTED require the `applications.decide` permission;
 * - leaving a terminal decision (re-opening) requires `applications.decide` and a reason;
 * - drafts cannot be moved by HR (they are not yet submitted).
 */
export function checkStageMove(
  from: { status: ApplicationStatus },
  toKind: StageKind,
  opts: { canDecide: boolean; reason?: string | null },
): StageMoveCheck {
  if (from.status === "DRAFT") return { ok: false, reason: "Draft applications have not been submitted" };
  if (from.status === "WITHDRAWN") return { ok: false, reason: "The candidate withdrew this application" };
  if (toKind === "WITHDRAWN") return { ok: false, reason: "Only the candidate can withdraw an application" };
  const toStatus = statusForStageKind(toKind);
  if ((toStatus === "HIRED" || toStatus === "REJECTED") && !opts.canDecide) return { ok: false, reason: "Recording a hiring decision requires decision permission" };
  if (isTerminalApplication(from.status)) {
    if (!opts.canDecide) return { ok: false, reason: "Re-opening a decided application requires decision permission" };
    if (!opts.reason?.trim()) return { ok: false, reason: "A reason is required to re-open a decided application" };
  }
  if ((toStatus === "HIRED" || toStatus === "REJECTED") && !opts.reason?.trim()) return { ok: false, reason: "Record a reason for the decision" };
  return { ok: true };
}

export function canCandidateWithdraw(status: ApplicationStatus) {
  return ["DRAFT", "SUBMITTED", "IN_REVIEW", "INTERVIEWING", "OFFER"].includes(status);
}

// ─────────── Interview sessions ───────────
/**
 * CREATED → INVITED → READY → IN_PROGRESS → PROCESSING → ASSESSED → REVIEWED → CLOSED
 * plus INTERRUPTED (resumable), REQUIRES_REVIEW, EXPIRED, CANCELLED, FAILED.
 */
export const SESSION_TRANSITIONS: Record<InterviewSessionStatus, InterviewSessionStatus[]> = {
  CREATED: ["INVITED", "CANCELLED"],
  INVITED: ["READY", "EXPIRED", "CANCELLED"],
  READY: ["IN_PROGRESS", "EXPIRED", "CANCELLED"],
  IN_PROGRESS: ["PROCESSING", "INTERRUPTED", "FAILED", "CANCELLED"],
  INTERRUPTED: ["IN_PROGRESS", "PROCESSING", "EXPIRED", "FAILED", "CANCELLED"],
  PROCESSING: ["ASSESSED", "REQUIRES_REVIEW", "FAILED"],
  ASSESSED: ["REVIEWED", "REQUIRES_REVIEW", "CLOSED"],
  REQUIRES_REVIEW: ["REVIEWED", "PROCESSING", "CLOSED"],
  REVIEWED: ["CLOSED"],
  CLOSED: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: ["PROCESSING"], // re-run assessment after a provider failure
};

export function canTransition(from: InterviewSessionStatus, to: InterviewSessionStatus) {
  return from === to || SESSION_TRANSITIONS[from].includes(to);
}

export const CANDIDATE_ACTIVE_STATES: InterviewSessionStatus[] = ["INVITED", "READY", "IN_PROGRESS", "INTERRUPTED"];

/**
 * Billing outcome when a session leaves the candidate-active phase.
 * Consumed only if the candidate actually submitted at least `minAnswers`.
 * Failures caused by the platform or an AI provider are never charged.
 */
export function billingOutcome(
  terminal: "PROCESSING" | "EXPIRED" | "CANCELLED" | "FAILED",
  answersSubmitted: number,
  opts: { minAnswers?: number; faultIsPlatform?: boolean } = {},
): "CONSUME" | "RELEASE" {
  const min = opts.minAnswers ?? 1;
  if (terminal === "FAILED" && opts.faultIsPlatform !== false) return "RELEASE";
  if (terminal === "CANCELLED") return "RELEASE";
  return answersSubmitted >= min ? "CONSUME" : "RELEASE";
}
