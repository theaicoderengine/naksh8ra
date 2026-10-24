import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getRedis } from "@/server/queue/redis";

export const dynamic = "force-dynamic";

/** Readiness: dependencies reachable. Returns 503 when not ready to receive traffic. */
export async function GET() {
  const db = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  const redis = getRedis();
  const r = redis ? await redis.ping().then((x) => x === "PONG").catch(() => false) : null;
  const ok = db && r !== false;
  return NextResponse.json({ status: ok ? "ready" : "not_ready", checks: { database: db, redis: r } }, { status: ok ? 200 : 503 });
}
