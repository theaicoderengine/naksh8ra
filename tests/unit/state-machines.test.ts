import { describe, it, expect } from "vitest";
import { nextJobStatus, jobAcceptsApplications, checkStageMove, statusForStageKind, canCandidateWithdraw, canTransition, billingOutcome, SESSION_TRANSITIONS } from "@/server/domain/state-machines";

describe("job lifecycle", () => {
  it("allows only valid transitions", () => {
    expect(nextJobStatus("DRAFT", "publish")).toBe("PUBLISHED");
    expect(nextJobStatus("PUBLISHED", "pause")).toBe("PAUSED");
    expect(nextJobStatus("PAUSED", "resume")).toBe("PUBLISHED");
    expect(nextJobStatus("CLOSED", "reopen")).toBe("PUBLISHED");
    expect(nextJobStatus("DRAFT", "pause")).toBeNull();
    expect(nextJobStatus("ARCHIVED", "publish")).toBeNull();
    expect(nextJobStatus("PUBLISHED", "archive")).toBeNull();
  });
  it("accepts applications only when published and before the deadline", () => {
    const now = new Date("2026-06-01");
    expect(jobAcceptsApplications({ status: "PUBLISHED", applicationDeadline: null }, now)).toBe(true);
    expect(jobAcceptsApplications({ status: "PUBLISHED", applicationDeadline: new Date("2026-05-01") }, now)).toBe(false);
    expect(jobAcceptsApplications({ status: "PAUSED", applicationDeadline: null }, now)).toBe(false);
  });
});

describe("application stage moves", () => {
  it("maps stage kinds to statuses", () => {
    expect(statusForStageKind("AI_INTERVIEW_INVITED")).toBe("INTERVIEWING");
    expect(statusForStageKind("HIRED")).toBe("HIRED");
    expect(statusForStageKind("NEW")).toBe("SUBMITTED");
  });
  it("requires decision permission and a reason for hire/reject", () => {
    expect(checkStageMove({ status: "IN_REVIEW" }, "HIRED", { canDecide: false, reason: "x" }).ok).toBe(false);
    expect(checkStageMove({ status: "IN_REVIEW" }, "REJECTED", { canDecide: true }).ok).toBe(false);
    expect(checkStageMove({ status: "IN_REVIEW" }, "REJECTED", { canDecide: true, reason: "Role filled" }).ok).toBe(true);
  });
  it("never lets HR move a withdrawn application or withdraw on the candidate's behalf", () => {
    expect(checkStageMove({ status: "WITHDRAWN" }, "REVIEW", { canDecide: true, reason: "x" }).ok).toBe(false);
    expect(checkStageMove({ status: "IN_REVIEW" }, "WITHDRAWN", { canDecide: true, reason: "x" }).ok).toBe(false);
    expect(checkStageMove({ status: "DRAFT" }, "REVIEW", { canDecide: true }).ok).toBe(false);
  });
  it("re-opening a decided application needs permission and a reason", () => {
    expect(checkStageMove({ status: "REJECTED" }, "REVIEW", { canDecide: false, reason: "x" }).ok).toBe(false);
    expect(checkStageMove({ status: "REJECTED" }, "REVIEW", { canDecide: true }).ok).toBe(false);
    expect(checkStageMove({ status: "REJECTED" }, "REVIEW", { canDecide: true, reason: "Rejected in error" }).ok).toBe(true);
  });
  it("candidates can withdraw active applications only", () => {
    expect(canCandidateWithdraw("IN_REVIEW")).toBe(true);
    expect(canCandidateWithdraw("HIRED")).toBe(false);
    expect(canCandidateWithdraw("WITHDRAWN")).toBe(false);
  });
});

describe("interview session lifecycle", () => {
  it("follows the documented happy path", () => {
    const path = ["CREATED", "INVITED", "READY", "IN_PROGRESS", "PROCESSING", "ASSESSED", "REVIEWED", "CLOSED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it("supports interruption, resume and failure recovery", () => {
    expect(canTransition("IN_PROGRESS", "INTERRUPTED")).toBe(true);
    expect(canTransition("INTERRUPTED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("FAILED", "PROCESSING")).toBe(true);
    expect(canTransition("PROCESSING", "REQUIRES_REVIEW")).toBe(true);
  });
  it("rejects illegal jumps and leaves terminal states terminal", () => {
    expect(canTransition("INVITED", "PROCESSING")).toBe(false);
    expect(canTransition("READY", "ASSESSED")).toBe(false);
    for (const t of ["CLOSED", "EXPIRED", "CANCELLED"] as const) expect(SESSION_TRANSITIONS[t]).toEqual([]);
  });
  it("same-state transition is an idempotent no-op", () => {
    expect(canTransition("IN_PROGRESS", "IN_PROGRESS")).toBe(true);
  });
});

describe("billable events", () => {
  it("consumes only when the candidate answered", () => {
    expect(billingOutcome("PROCESSING", 3)).toBe("CONSUME");
    expect(billingOutcome("PROCESSING", 0)).toBe("RELEASE");
    expect(billingOutcome("EXPIRED", 0)).toBe("RELEASE");
    expect(billingOutcome("EXPIRED", 2)).toBe("CONSUME");
  });
  it("never charges for cancellations or platform failures", () => {
    expect(billingOutcome("CANCELLED", 5)).toBe("RELEASE");
    expect(billingOutcome("FAILED", 5)).toBe("RELEASE");
  });
});
