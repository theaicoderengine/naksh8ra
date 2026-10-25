/** Client-safe display labels for AI providers (shared by server and UI). */
export const PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: "Anthropic",
  OPENAI: "OpenAI",
  GEMINI: "Google Gemini",
  DEEPGRAM: "Deepgram",
  ELEVENLABS: "ElevenLabs",
  FIXTURE: "Fixture (test only)",
};

export const FREE_TIER_LABEL: Record<string, string> = {
  ELIGIBLE: "Free tier eligible",
  PAID_ONLY: "Paid",
  UNKNOWN: "Check provider plan",
};

export const providerLabel = (p: string | null | undefined) => (p ? (PROVIDER_LABEL[p] ?? p) : "—");
