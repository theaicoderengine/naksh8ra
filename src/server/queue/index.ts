import { Queue, type JobsOptions } from "bullmq";
import { newRedisConnection } from "./redis";
import { prisma } from "../db/client";
import { logger } from "../logger";
import { env } from "../env";

/**
 * Background jobs. Every payload that touches tenant data carries
 * `organisationId`; handlers re-open the correct tenant context themselves
 * (see handlers.ts) — tenant context is never implicit across the queue.
 */
export type JobPayloads = {
  "email.send": { deliveryId: string };
  "resume.parse": { resumeVersionId: string; userId: string };
  "interview.assess": { sessionId: string; organisationId: string };
  "practice.feedback": { practiceId: string; userId: string };
  "interview.reminders": Record<string, never>;
  "invitations.expire": Record<string, never>;
  "sessions.timeout": Record<string, never>;
  "retention.sweep": Record<string, never>;
  "dsr.export": { requestId: string };
  "dsr.delete": { requestId: string };
  "billing.reconcile": Record<string, never>;
  "credits.expire": Record<string, never>;
  "ai.reservations.sweep": Record<string, never>;
};
export type JobName = keyof JobPayloads;

export const QUEUE_NAME = "atlas-default";

let queue: Queue | null = null;
function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: newRedisConnection() });
  return queue;
}

/**
 * redis    — BullMQ + `npm run worker` (container platforms)
 * postgres — durable JobRun rows processed in the web process + cron tick (Hostinger; see ./pg.ts)
 * inline   — run inside the request (tests / local dev only; refused in staging and production)
 */
export function queueMode(): "redis" | "postgres" | "inline" {
  const mode = process.env.QUEUE_MODE;
  if (mode === "postgres") return "postgres";
  if (mode === "inline" || !process.env.REDIS_URL) return "inline";
  return "redis";
}

/** Track runs for the platform "failed jobs" view. */
export async function recordJob(name: string, status: string, data: { organisationId?: string; externalId?: string; error?: string; attempts?: number; id?: string; payload?: unknown }) {
  if (data.id) {
    await prisma.jobRun.update({
      where: { id: data.id },
      data: { status, error: data.error?.slice(0, 2000), attempts: data.attempts, finishedAt: ["COMPLETED", "FAILED"].includes(status) ? new Date() : null },
    });
    return data.id;
  }
  const row = await prisma.jobRun.create({ data: { queue: QUEUE_NAME, name, status, organisationId: data.organisationId, externalId: data.externalId, payload: (data.payload ?? undefined) as never } });
  return row.id;
}

export async function enqueue<N extends JobName>(name: N, payload: JobPayloads[N], opts: JobsOptions = {}) {
  const organisationId = (payload as { organisationId?: string }).organisationId;
  const mode = queueMode();
  if (mode === "postgres") {
    const { pgEnqueue } = await import("./pg");
    await pgEnqueue(name, payload, { delayMs: typeof opts.delay === "number" ? opts.delay : undefined, maxAttempts: opts.attempts });
    const { kickRunner } = await import("./runner");
    kickRunner(env().JOB_CONCURRENCY);
    return;
  }
  if (mode === "inline") {
    // Inline mode (tests / single-process dev): run now, but never let a job
    // failure break the request that scheduled it — mirror queue semantics.
    const runId = await recordJob(name, "RUNNING", { organisationId, payload });
    const { runHandler } = await import("./handlers");
    try {
      await runHandler(name, payload);
      await recordJob(name, "COMPLETED", { id: runId, attempts: 1 });
    } catch (err) {
      logger.error({ err, job: name }, "inline job failed");
      await recordJob(name, "FAILED", { id: runId, attempts: 1, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  const runId = await recordJob(name, "QUEUED", { organisationId, payload });
  await getQueue().add(name, { ...payload, __runId: runId }, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    removeOnFail: { age: 14 * 24 * 3600 },
    ...opts,
  });
}

export async function closeQueue() {
  await queue?.close();
  queue = null;
}
