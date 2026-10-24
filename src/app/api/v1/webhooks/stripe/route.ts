import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyStripeSignature, handleStripeEvent } from "@/server/services/billing";
import { toErrorBody } from "@/server/errors";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/** Stripe webhooks: signature-verified, idempotent (unique provider event id). */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  try {
    const event = verifyStripeSignature(raw, req.headers.get("stripe-signature"));
    const r = await handleStripeEvent(event);
    return NextResponse.json({ received: true, status: r.status });
  } catch (err) {
    const { status, body } = toErrorBody(err);
    logger.warn({ status, code: body.error.code }, "stripe webhook rejected");
    return NextResponse.json(body, { status: status === 500 ? 500 : status });
  }
}
