import { NextResponse } from "next/server";
import { jobHealth } from "@/server/ops/status";

export const dynamic = "force-dynamic";

/**
 * Background-job health for uptime monitors: 503 when due jobs wait longer than 15 minutes or
 * no job runner (in-process or cron tick) has been seen for 15 minutes.
 */
export async function GET() {
  try {
    const h = await jobHealth();
    return NextResponse.json({ status: h.healthy ? "ok" : "stalled", ...h }, { status: h.healthy ? 200 : 503 });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
