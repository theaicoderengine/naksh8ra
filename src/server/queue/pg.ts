import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { logger } from "../logger";
import type { JobName, JobPayloads } from "./index";
import { SCHEDULES, latestSlot } from "./schedules";

/**
 * Postgres-backed job queue (QUEUE_MODE=postgres), for hosts that offer neither Redis nor
 * separate worker processes (e.g. Hostinger Node.js hosting). Jobs are durable `JobRun` rows:
 *
 * - claimed with `FOR UPDATE SKIP LOCKED`, so several runners never take the same job;
 * - held under a lease that the runner renews while the handler runs; a job whose runner
 *   stopped (process restarted or idled out) is reclaimed when the lease expires;
 * - retried with exponential backoff up to `maxAttempts`, then left FAILED for the platform
 *   "failed jobs" view (where an admin can retry it). Nothing is reported as done unless the
 *   handler returned.
 */
export const PG_QUEUE = "atlas-pg";
const LEASE_MS = 10 * 60_000;
const RENEW_MS = 60_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 30 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

export type HeartbeatSource = "in-process" | "tick" | "cli";

export async function pgEnqueue<N extends JobName>(name: N, payload: JobPayloads[N], opts: { delayMs?: number; maxAttempts?: number; tx?: Prisma.TransactionClient } = {}) {
  const organisationId = (payload as { organisationId?: string }).organisationId;
  const row = await (opts.tx ?? prisma).jobRun.create({
    data: {
      queue: PG_QUEUE,
      name,
      status: "QUEUED",
      organisationId,
      payload: payload as never,
      runAt: new Date(Date.now() + (opts.delayMs ?? 0)),
      maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    },
  });
  return row.id;
}

type Claimed = { id: string; name: string; payload: unknown; attempts: number; maxAttempts: number };

/** Mark RUNNING jobs whose lease expired on their final attempt as FAILED (their runner died). */
async function failAbandoned(now: Date) {
  const n = await prisma.$executeRaw`
    UPDATE "JobRun" SET status = 'FAILED', "finishedAt" = ${now}, "lockedBy" = NULL, "lockedUntil" = NULL,
      error = 'The runner stopped during the final attempt (lease expired)'
    WHERE queue = ${PG_QUEUE} AND status = 'RUNNING' AND "lockedUntil" < ${now} AND attempts >= "maxAttempts"`;
  if (n) logger.warn({ jobs: n }, "jobs failed after their runner stopped on the final attempt");
}

/** Claim the next due job (or one whose runner's lease expired). */
export async function claimNext(runnerId: string): Promise<Claimed | null> {
  const now = new Date();
  await failAbandoned(now);
  const rows = await prisma.$queryRaw<Claimed[]>`
    WITH next AS (
      SELECT id FROM "JobRun"
      WHERE queue = ${PG_QUEUE}
        AND ((status = 'QUEUED' AND "runAt" <= ${now})
          OR (status = 'RUNNING' AND "lockedUntil" < ${now} AND attempts < "maxAttempts"))
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "JobRun" j SET status = 'RUNNING', attempts = j.attempts + 1, "lockedBy" = ${runnerId},
      "lockedUntil" = ${new Date(now.getTime() + LEASE_MS)}, "startedAt" = ${now}
    FROM next WHERE j.id = next.id
    RETURNING j.id, j.name, j.payload, j.attempts, j."maxAttempts"`;
  return rows[0] ?? null;
}

/** Run one claimed job to completion, renewing its lease; records the outcome. */
export async function runClaimed(job: Claimed, runnerId: string): Promise<"COMPLETED" | "RETRY" | "FAILED"> {
  const started = Date.now();
  const renew = setInterval(() => {
    prisma.jobRun
      .updateMany({ where: { id: job.id, lockedBy: runnerId, status: "RUNNING" }, data: { lockedUntil: new Date(Date.now() + LEASE_MS) } })
      .catch((err) => logger.warn({ err: (err as Error).message, job: job.name }, "job lease renewal failed"));
  }, RENEW_MS);
  renew.unref?.();
  try {
    const { runHandler } = await import("./handlers");
    await runHandler(job.name as JobName, job.payload as never);
    // Only the runner still holding the lease may record the result.
    await prisma.jobRun.updateMany({
      where: { id: job.id, lockedBy: runnerId },
      data: { status: "COMPLETED", finishedAt: new Date(), lockedBy: null, lockedUntil: null, error: null },
    });
    logger.info({ job: job.name, attempt: job.attempts, ms: Date.now() - started }, "job completed");
    return "COMPLETED";
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    const final = job.attempts >= job.maxAttempts;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (job.attempts - 1), BACKOFF_MAX_MS);
    await prisma.jobRun.updateMany({
      where: { id: job.id, lockedBy: runnerId },
      data: final
        ? { status: "FAILED", finishedAt: new Date(), lockedBy: null, lockedUntil: null, error: message }
        : { status: "QUEUED", runAt: new Date(Date.now() + delay), lockedBy: null, lockedUntil: null, error: message },
    });
    logger.error({ job: job.name, attempt: job.attempts, final, err: message }, "job failed");
    return final ? "FAILED" : "RETRY";
  } finally {
    clearInterval(renew);
  }
}

/**
 * Enqueue every recurring job whose latest slot has not been enqueued yet. Idempotent across
 * concurrent runners: the JobSchedule row is advanced atomically with the enqueue. A job that is
 * still queued or running is not enqueued twice; missed slots collapse into one run.
 */
export async function scheduleDue(now = new Date()): Promise<JobName[]> {
  const enqueued: JobName[] = [];
  for (const s of SCHEDULES) {
    const slot = latestSlot(s.pattern, now);
    const done = await prisma.$transaction(async (tx) => {
      const advanced = await tx.$executeRaw`
        INSERT INTO "JobSchedule" (name, "lastSlot", "updatedAt") VALUES (${s.name}, ${slot}, ${now})
        ON CONFLICT (name) DO UPDATE SET "lastSlot" = EXCLUDED."lastSlot", "updatedAt" = EXCLUDED."updatedAt"
        WHERE "JobSchedule"."lastSlot" < EXCLUDED."lastSlot"`;
      if (!advanced) return false;
      const pending = await tx.jobRun.count({ where: { queue: PG_QUEUE, name: s.name, status: { in: ["QUEUED", "RUNNING"] } } });
      if (pending) return false;
      await pgEnqueue(s.name, {} as never, { tx, maxAttempts: 3 });
      return true;
    });
    if (done) enqueued.push(s.name);
  }
  return enqueued;
}

export async function heartbeat(source: HeartbeatSource, processed = 0) {
  const now = new Date();
  await prisma.jobRunnerHeartbeat.upsert({
    where: { source },
    create: { source, lastSeenAt: now, processed },
    update: { lastSeenAt: now, processed: { increment: processed } },
  });
}

/**
 * Process due jobs until none are left or `maxMs` has passed (a job already started is allowed
 * to finish). Returns the outcome counts.
 */
export async function drain(opts: { maxMs: number; concurrency: number; source: HeartbeatSource; runnerId?: string }) {
  const runnerId = opts.runnerId ?? `${opts.source}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;
  const until = Date.now() + opts.maxMs;
  const counts = { COMPLETED: 0, RETRY: 0, FAILED: 0 };
  const lane = async () => {
    while (Date.now() < until) {
      const job = await claimNext(runnerId);
      if (!job) return;
      counts[await runClaimed(job, runnerId)]++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, lane));
  await heartbeat(opts.source, counts.COMPLETED + counts.RETRY + counts.FAILED);
  return counts;
}

/** Queue health for readiness/monitoring. */
export async function queueStats(now = new Date()) {
  const [queued, running, failedLastDay, oldest, beats] = await Promise.all([
    prisma.jobRun.count({ where: { queue: PG_QUEUE, status: "QUEUED", runAt: { lte: now } } }),
    prisma.jobRun.count({ where: { queue: PG_QUEUE, status: "RUNNING" } }),
    prisma.jobRun.count({ where: { queue: PG_QUEUE, status: "FAILED", finishedAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } }),
    prisma.jobRun.findFirst({ where: { queue: PG_QUEUE, status: "QUEUED", runAt: { lte: now } }, orderBy: { runAt: "asc" }, select: { runAt: true } }),
    prisma.jobRunnerHeartbeat.findMany(),
  ]);
  const lastSeen = Object.fromEntries(beats.map((b) => [b.source, b.lastSeenAt.toISOString()]));
  return {
    queued,
    running,
    failedLastDay,
    oldestDueSeconds: oldest ? Math.round((now.getTime() - oldest.runAt.getTime()) / 1000) : 0,
    lastSeen,
  };
}
