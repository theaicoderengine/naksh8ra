/** Client-safe display labels for AI providers (shared by server and UI). */
export const PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: "Anthropic",
  OPENAI: "OpenAI",
  GEMINI: "Google Gemini",
  DEEPGRAM: "Deepgram",
  ELEVENLABS: "ElevenLabs",
  FIXTURE: "Fixture (test only)",
};

/**
 * Advisory only: reflects the provider's published information when the catalogue was
 * last reviewed. Quotas, availability, billing and data-use terms are set by the provider,
 * can change at any time, and are never guaranteed by this platform.
 */
export const FREE_TIER_LABEL: Record<string, string> = {
  ELIGIBLE: "Free tier may be available (advisory)",
  PAID_ONLY: "Paid",
  UNKNOWN: "Check your provider plan",
};

export const providerLabel = (p: string | null | undefined) => (p ? (PROVIDER_LABEL[p] ?? p) : "—");
