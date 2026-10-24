import { prisma } from "../db/client";
import { logger } from "../logger";

export type UsageCtx = { organisationId?: string | null; userId?: string | null; sessionId?: string | null };

/**
 * Estimated provider unit prices in micro-USD. These are estimates for cost
 * monitoring only (not billing); verify against the provider's current price
 * list and override with PROVIDER_PRICES_JSON, e.g.
 *   {"anthropic:claude-opus-5-5:input_tokens": 4, "openai:whisper-1:seconds": 100}
 */
const DEFAULT_PRICES: Record<string, number> = {
  "anthropic:claude-opus-5-5:input_tokens": 4,
  "anthropic:claude-opus-5-5:output_tokens": 20,
  "anthropic:claude-sonnet-5-5:input_tokens": 2,
  "anthropic:claude-sonnet-5-5:output_tokens": 10,
  "anthropic:claude-haiku-5-5:input_tokens": 0.1,
  "anthropic:claude-haiku-5-5:output_tokens": 0.5,
};

function prices(): Record<string, number> {
  try {
    return { ...DEFAULT_PRICES, ...(process.env.PROVIDER_PRICES_JSON ? JSON.parse(process.env.PROVIDER_PRICES_JSON) : {}) };
  } catch {
    return DEFAULT_PRICES;
  }
}

export async function recordUsage(u: UsageCtx & { kind: "LLM" | "STT" | "TTS" | "STORAGE" | "EMAIL"; provider: string; model?: string; units: number; unitLabel: string }) {
  if (u.provider === "fixture") return;
  const unitPrice = prices()[`${u.provider}:${u.model ?? ""}:${u.unitLabel}`] ?? prices()[`${u.provider}::${u.unitLabel}`] ?? 0;
  try {
    await prisma.usageRecord.create({
      data: {
        organisationId: u.organisationId ?? null,
        userId: u.userId ?? null,
        sessionId: u.sessionId ?? null,
        kind: u.kind,
        provider: u.provider,
        model: u.model,
        units: u.units,
        unitLabel: u.unitLabel,
        costMicros: Math.round(unitPrice * u.units),
      },
    });
  } catch (err) {
    logger.warn({ err }, "usage record failed");
  }
}
