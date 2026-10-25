import type { JobName, JobPayloads } from "./index";

/**
 * Job handlers. Each handler resolves tenant context from the payload's
 * explicit ids (organisationId / userId) — never ambient state.
 */
export async function runHandler<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<unknown> {
  switch (name) {
    case "email.send": {
      const { deliverEmail } = await import("../services/notifications");
      return deliverEmail((payload as JobPayloads["email.send"]).deliveryId);
    }
    case "resume.parse": {
      const { parseResume } = await import("../services/resumes");
      return parseResume((payload as JobPayloads["resume.parse"]).resumeVersionId);
    }
    case "interview.assess": {
      const { runAssessment } = await import("../services/assessments");
      const p = payload as JobPayloads["interview.assess"];
      return runAssessment(p.organisationId, p.sessionId);
    }
    case "practice.feedback": {
      const { generatePracticeFeedback } = await import("../services/practice");
      return generatePracticeFeedback((payload as JobPayloads["practice.feedback"]).practiceId);
    }
    case "interview.reminders": {
      const { sendReminders } = await import("../services/interviews");
      return sendReminders();
    }
    case "invitations.expire":
    case "sessions.timeout": {
      const { sweepSessions } = await import("../services/interviews");
      return sweepSessions();
    }
    case "retention.sweep": {
      const { retentionSweep } = await import("../services/privacy");
      return retentionSweep();
    }
    case "dsr.export": {
      const { processExport } = await import("../services/privacy");
      return processExport((payload as JobPayloads["dsr.export"]).requestId);
    }
    case "dsr.delete": {
      const { processDeletion } = await import("../services/privacy");
      return processDeletion((payload as JobPayloads["dsr.delete"]).requestId);
    }
    case "billing.reconcile":
    case "credits.expire": {
      const { reconcileAllAccounts, retryFailedPaymentEvents } = await import("../services/billing");
      const r = await reconcileAllAccounts();
      await retryFailedPaymentEvents();
      return r;
    }
    case "ai.reservations.sweep": {
      const { sweepExpiredReservations } = await import("../ai/access");
      return sweepExpiredReservations();
    }
    default:
      throw new Error(`Unknown job ${String(name)}`);
  }
}
