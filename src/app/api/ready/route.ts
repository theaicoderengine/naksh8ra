import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getRedis } from "@/server/queue/redis";
import { migrationStatus } from "@/server/ops/status";

export const dynamic = "force-dynamic";

/**
 * Readiness: dependencies reachable and the database schema matches this release.
 * Returns 503 when not ready to receive traffic.
 */
export async function GET() {
  const db = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  const redis = getRedis();
  const r = redis ? await redis.ping().then((x) => x === "PONG").catch(() => false) : null;
  const migrations = db ? await migrationStatus() : "unknown";
  const ok = db && r !== false && migrations !== "pending";
  return NextResponse.json({ status: ok ? "ready" : "not_ready", checks: { database: db, redis: r, migrations } }, { status: ok ? 200 : 503 });
}
