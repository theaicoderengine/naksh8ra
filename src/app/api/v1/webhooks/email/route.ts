import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/server/env";
import { hmac, safeEqual } from "@/server/auth/crypto";
import { recordEmailStatus } from "@/server/services/notifications";

/**
 * Generic email-delivery webhook. Configure your provider (or a small relay)
 * to POST {messageId, status, error?} with header x-atlas-signature =
 * hex HMAC-SHA256(EMAIL_WEBHOOK_SECRET, raw body).
 */
const schema = z.object({ messageId: z.string().max(200), status: z.enum(["DELIVERED", "BOUNCED", "FAILED"]), error: z.string().max(500).optional() });

export async function POST(req: NextRequest) {
  const secret = env().EMAIL_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "PROVIDER_NOT_CONFIGURED", message: "EMAIL_WEBHOOK_SECRET not set" } }, { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("x-atlas-signature") ?? "";
  if (!safeEqual(sig, hmac(secret, raw))) return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid signature" } }, { status: 400 });
  const body = schema.safeParse(JSON.parse(raw || "{}"));
  if (!body.success) return NextResponse.json({ error: { code: "VALIDATION_FAILED", message: "Invalid payload" } }, { status: 422 });
  await recordEmailStatus(body.data.messageId, body.data.status, body.data.error);
  return NextResponse.json({ received: true });
}
