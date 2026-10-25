import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

function authorised(req: NextRequest) {
  const secret = env().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!secret || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Called every minute by the host's cron (Postgres queue only). Wakes an idle site, enqueues
 * recurring jobs that are due, and starts the in-process runner. Without an in-process runner
 * (JOB_RUNNER_IN_PROCESS=false) it processes jobs itself for at most TICK_BUDGET_MS, staying
 * well inside the host's request time limit. Returns queue health for the cron log.
 */
const TICK_BUDGET_MS = 60_000;

export async function POST(req: NextRequest) {
  const e = env();
  if (e.QUEUE_MODE !== "postgres") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  if (!authorised(req)) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Invalid cron secret" } }, { status: 401 });
  const { scheduleDue, drain, heartbeat, queueStats } = await import("@/server/queue/pg");
  const { kickRunner } = await import("@/server/queue/runner");
  try {
    const scheduled = await scheduleDue();
    let processed: Record<string, number> | null = null;
    let runner: "in-process" | "tick" = "in-process";
    if (!kickRunner(e.JOB_CONCURRENCY)) {
      runner = "tick";
      processed = await drain({ maxMs: TICK_BUDGET_MS, concurrency: e.JOB_CONCURRENCY, source: "tick" });
    } else {
      await heartbeat("tick");
    }
    const stats = await queueStats();
    return NextResponse.json({ data: { scheduled, runner, processed, ...stats } }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "job tick failed");
    return NextResponse.json({ error: { code: "INTERNAL", message: "Job tick failed" } }, { status: 500 });
  }
}
