/**
 * Background worker entry point: `npm run worker`.
 * Scales independently from the web tier (run N replicas). Requires REDIS_URL.
 */
import http from "node:http";
import { Worker, Queue } from "bullmq";
import { QUEUE_NAME, recordJob, type JobName } from "../server/queue";
import { runHandler } from "../server/queue/handlers";
import { SCHEDULES } from "../server/queue/schedules";
import { newRedisConnection } from "../server/queue/redis";
import { logger } from "../server/logger";
import { prisma } from "../server/db/client";

// SERVICE_NAME is set by `npm run worker` (the logger reads it at import time).
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 8);


async function main() {
  const connection = newRedisConnection();
  const queue = new Queue(QUEUE_NAME, { connection });
  for (const s of SCHEDULES) {
    await queue.upsertJobScheduler(`cron:${s.name}`, { pattern: s.pattern }, { name: s.name, data: {} });
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { __runId, ...payload } = job.data as { __runId?: string };
      const started = Date.now();
      if (__runId) await recordJob(job.name, "RUNNING", { id: __runId, attempts: job.attemptsMade + 1 });
      try {
        const result = await runHandler(job.name as JobName, payload as never);
        if (__runId) await recordJob(job.name, "COMPLETED", { id: __runId, attempts: job.attemptsMade + 1 });
        logger.info({ job: job.name, ms: Date.now() - started }, "job completed");
        return result ?? null;
      } catch (err) {
        const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        if (__runId) await recordJob(job.name, final ? "FAILED" : "QUEUED", { id: __runId, attempts: job.attemptsMade + 1, error: err instanceof Error ? err.message : String(err) });
        logger.error({ job: job.name, attempt: job.attemptsMade + 1, final, err: err instanceof Error ? err.message : String(err) }, "job failed");
        throw err;
      }
    },
    { connection: newRedisConnection(), concurrency },
  );

  // Liveness/readiness for the orchestrator.
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 3001);
  const server = http
    .createServer(async (req, res) => {
      const ok = worker.isRunning() && (await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false));
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ ok, queue: QUEUE_NAME }));
    })
    .listen(port);

  logger.info({ concurrency, port }, "worker started");
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    server.close();
    await worker.close();
    await queue.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "worker crashed");
  process.exit(1);
});
