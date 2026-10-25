/**
 * Process the Postgres job queue from the command line (SSH, or a host cron job):
 *   npm run jobs:run -- [--env-file=/path/to/.env] [--max-seconds=1500] [--concurrency=2]
 * Enqueues due recurring jobs, then works through due jobs until none are left or the time
 * budget is used (default 25 minutes, inside Hostinger's 30-minute cron limit). Host cron jobs
 * do not receive the site's environment variables, hence --env-file. Exit code 1 if any job
 * failed permanently in this run.
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string]));
if (args["env-file"]) process.loadEnvFile(args["env-file"]);
process.env.SERVICE_NAME ??= "atlas-jobs-cli";

async function main() {
  const { env } = await import("../src/server/env");
  if (env().QUEUE_MODE !== "postgres") throw new Error("jobs:run is for QUEUE_MODE=postgres");
  const { scheduleDue, drain, queueStats } = await import("../src/server/queue/pg");
  const { prisma } = await import("../src/server/db/client");
  const scheduled = await scheduleDue();
  const counts = await drain({ maxMs: Number(args["max-seconds"] ?? 1500) * 1000, concurrency: Number(args.concurrency ?? env().JOB_CONCURRENCY), source: "cli" });
  const stats = await queueStats();
  console.log(JSON.stringify({ scheduled, ...counts, queued: stats.queued, running: stats.running, oldestDueSeconds: stats.oldestDueSeconds }));
  await prisma.$disconnect();
  process.exitCode = counts.FAILED > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
