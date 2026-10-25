/**
 * Node server start-up: validate configuration (a misconfigured deployment fails at start-up
 * instead of serving), log process-level errors, and start the in-process job runner when the
 * Postgres queue is used (QUEUE_MODE=postgres, e.g. Hostinger).
 */
import { env } from "./server/env";
import { logger } from "./server/logger";
import { startInProcessRunner, stopInProcessRunner } from "./server/queue/runner";

const e = env();

process.on("unhandledRejection", (reason) => logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, "unhandled promise rejection"));

if (e.QUEUE_MODE === "postgres" && e.JOB_RUNNER_IN_PROCESS) {
  startInProcessRunner(e.JOB_CONCURRENCY);
  // Jobs interrupted by a stop are reclaimed by the next runner when their lease expires.
  process.once("SIGTERM", stopInProcessRunner);
  process.once("SIGINT", stopInProcessRunner);
}
logger.info({ appEnv: e.APP_ENV, queue: e.QUEUE_MODE, storage: e.STORAGE_PROVIDER }, "server started");
