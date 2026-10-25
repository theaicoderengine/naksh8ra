import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db/client";
import { queueMode } from "../queue";

/**
 * Applied vs. shipped migrations. "unknown" where the migrations folder is not deployed
 * (container images that ship only the standalone server).
 */
export async function migrationStatus(): Promise<"up_to_date" | "pending" | "unknown"> {
  let shipped: string[];
  try {
    const dir = path.join(process.cwd(), "prisma", "migrations");
    shipped = (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return "unknown";
  }
  try {
    // SECURITY DEFINER function from the job-queue migration: names only, no table access.
    const rows = await prisma.$queryRaw<{ name: string }[]>`SELECT atlas_applied_migrations() AS name`;
    const applied = new Set(rows.map((r) => r.name));
    return shipped.every((m) => applied.has(m)) ? "up_to_date" : "pending";
  } catch {
    return "unknown";
  }
}

/** Jobs are healthy when due jobs are not piling up and a runner was seen recently. */
export const JOB_STALE_SECONDS = 15 * 60;

export async function jobHealth() {
  const mode = queueMode();
  if (mode !== "postgres") return { mode, healthy: true as boolean, oldestDueSeconds: null as number | null, lastRunnerSeenSeconds: null as number | null };
  const { queueStats } = await import("../queue/pg");
  const s = await queueStats();
  const seen = Object.values(s.lastSeen).map((t) => Date.parse(t));
  const lastRunnerSeenSeconds = seen.length ? Math.round((Date.now() - Math.max(...seen)) / 1000) : null;
  const healthy = s.oldestDueSeconds < JOB_STALE_SECONDS && lastRunnerSeenSeconds !== null && lastRunnerSeenSeconds < JOB_STALE_SECONDS;
  return { mode, healthy, oldestDueSeconds: s.oldestDueSeconds, lastRunnerSeenSeconds };
}
