import type { AiCapability, AiProvider } from "@prisma/client";
import { z } from "zod";
import { env } from "../env";
import { logger } from "../logger";

/** Text-generation capabilities: resolvable with an organisation-owned key or a granted platform key. */
export const TEXT_CAPABILITIES = ["JOB_DRAFTING", "RESUME_PARSING", "QUESTION_GENERATION", "INTERVIEW_CONVERSATION", "ASSESSMENT", "PRACTICE_COACHING"] as const satisfies readonly AiCapability[];
/** Speech capabilities: platform (deployment) providers only. A text-generation key never enables these. */
export const SPEECH_CAPABILITIES = ["TRANSCRIPTION", "SPEECH_SYNTHESIS"] as const satisfies readonly AiCapability[];

export type TextCapability = (typeof TEXT_CAPABILITIES)[number];
export type SpeechCapability = (typeof SPEECH_CAPABILITIES)[number];

export const CAPABILITY_INFO: Record<AiCapability, { label: string; description: string; scopes: ("ORG" | "PERSONAL")[] }> = {
  JOB_DRAFTING: { label: "Vacancy drafting", description: "AI-assisted job description drafts (always human-reviewed)", scopes: ["ORG"] },
  RESUME_PARSING: { label: "Resume parsing", description: "Structured extraction from uploaded resumes", scopes: ["PERSONAL"] },
  QUESTION_GENERATION: { label: "Question generation", description: "Suggested and adaptive interview questions", scopes: ["ORG"] },
  INTERVIEW_CONVERSATION: { label: "Conversational interviewer", description: "Turn-by-turn interviewer in conversational mode", scopes: ["ORG"] },
  ASSESSMENT: { label: "Evidence-based assessment", description: "Competency ratings with verified evidence for human review", scopes: ["ORG"] },
  PRACTICE_COACHING: { label: "Practice coaching", description: "Student practice questions and private feedback", scopes: ["PERSONAL"] },
  TRANSCRIPTION: { label: "Speech-to-text", description: "Transcribing spoken answers (deployment speech provider)", scopes: ["ORG", "PERSONAL"] },
  SPEECH_SYNTHESIS: { label: "Text-to-speech", description: "Server-side interviewer voice (deployment speech provider; browser voice needs no grant)", scopes: ["ORG", "PERSONAL"] },
};

/** Providers an organisation can connect with its own key. FIXTURE is test-only. */
export const BYOK_PROVIDERS = ["GEMINI", "OPENAI", "ANTHROPIC"] as const satisfies readonly AiProvider[];
export const LLM_PROVIDERS = ["ANTHROPIC", "OPENAI", "GEMINI", "FIXTURE"] as const satisfies readonly AiProvider[];
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  ANTHROPIC: "Anthropic",
  OPENAI: "OpenAI",
  GEMINI: "Google Gemini",
  DEEPGRAM: "Deepgram",
  ELEVENLABS: "ElevenLabs",
  FIXTURE: "Fixture (test only)",
};

/**
 * Free-tier eligibility as last published by the provider. This is informational:
 * quotas, availability, billing status and data-use terms differ between free and
 * paid tiers and change over time. The platform never promises free usage and never
 * switches models after a quota error.
 */
export type FreeTier = "ELIGIBLE" | "PAID_ONLY" | "UNKNOWN";

export type ModelInfo = { id: string; provider: LlmProviderId; label: string; freeTier: FreeTier; structuredOutput: boolean; notes?: string };

const DEFAULT_MODELS: ModelInfo[] = [
  { id: "gemini-2.5-flash", provider: "GEMINI", label: "Gemini 2.5 Flash", freeTier: "ELIGIBLE", structuredOutput: true, notes: "Free-tier eligible per Google's published model list; free-tier limits are lower and data may be used to improve Google products." },
  { id: "gemini-2.5-flash-lite", provider: "GEMINI", label: "Gemini 2.5 Flash-Lite", freeTier: "ELIGIBLE", structuredOutput: true, notes: "Free-tier eligible per Google's published model list." },
  { id: "gemini-2.5-pro", provider: "GEMINI", label: "Gemini 2.5 Pro", freeTier: "UNKNOWN", structuredOutput: true, notes: "Free-tier availability has varied; check your Google AI Studio plan." },
  { id: "claude-opus-5-5", provider: "ANTHROPIC", label: "Claude Opus 5.5", freeTier: "PAID_ONLY", structuredOutput: true },
  { id: "claude-sonnet-5-5", provider: "ANTHROPIC", label: "Claude Sonnet 5.5", freeTier: "PAID_ONLY", structuredOutput: true },
  { id: "claude-haiku-5-5", provider: "ANTHROPIC", label: "Claude Haiku 5.5", freeTier: "PAID_ONLY", structuredOutput: true },
  { id: "gpt-4.1", provider: "OPENAI", label: "GPT-4.1", freeTier: "PAID_ONLY", structuredOutput: true },
  { id: "gpt-4.1-mini", provider: "OPENAI", label: "GPT-4.1 mini", freeTier: "PAID_ONLY", structuredOutput: true },
  { id: "fixture-llm-v1", provider: "FIXTURE", label: "Fixture (deterministic, test only)", freeTier: "UNKNOWN", structuredOutput: true },
];

const catalogOverride = z.array(
  z.object({
    id: z.string().min(1).max(120),
    provider: z.enum(LLM_PROVIDERS),
    label: z.string().max(120).optional(),
    freeTier: z.enum(["ELIGIBLE", "PAID_ONLY", "UNKNOWN"]).default("UNKNOWN"),
    structuredOutput: z.boolean().default(true),
    notes: z.string().max(500).optional(),
    remove: z.boolean().optional(),
  }),
);

/**
 * Supported models = built-in list, adjusted by AI_MODEL_CATALOG_JSON (add/override/remove
 * entries) so operators can track provider changes without a release. Deployment default
 * models are always included for their provider.
 */
export function modelCatalog(): ModelInfo[] {
  const byKey = new Map(DEFAULT_MODELS.map((m) => [`${m.provider}:${m.id}`, m]));
  const raw = process.env.AI_MODEL_CATALOG_JSON;
  if (raw) {
    try {
      for (const o of catalogOverride.parse(JSON.parse(raw))) {
        const k = `${o.provider}:${o.id}`;
        if (o.remove) byKey.delete(k);
        else byKey.set(k, { id: o.id, provider: o.provider, label: o.label ?? o.id, freeTier: o.freeTier, structuredOutput: o.structuredOutput, notes: o.notes });
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "AI_MODEL_CATALOG_JSON ignored (invalid)");
    }
  }
  for (const p of ["ANTHROPIC", "OPENAI", "GEMINI"] as const) {
    for (const id of [deploymentDefaultModel(p, false), deploymentDefaultModel(p, true)]) {
      const k = `${p}:${id}`;
      if (!byKey.has(k)) byKey.set(k, { id, provider: p, label: id, freeTier: "UNKNOWN", structuredOutput: true });
    }
  }
  return [...byKey.values()];
}

export function findModel(provider: AiProvider, id: string): ModelInfo | null {
  return modelCatalog().find((m) => m.provider === provider && m.id === id) ?? null;
}

export function deploymentDefaultModel(provider: LlmProviderId, fast: boolean): string {
  const e = env();
  switch (provider) {
    case "ANTHROPIC":
      return fast ? e.ANTHROPIC_FAST_MODEL : e.ANTHROPIC_MODEL;
    case "OPENAI":
      return e.OPENAI_MODEL;
    case "GEMINI":
      return fast ? e.GEMINI_FAST_MODEL : e.GEMINI_MODEL;
    case "FIXTURE":
      return "fixture-llm-v1";
  }
}

export function isLlmProvider(p: AiProvider): p is LlmProviderId {
  return (LLM_PROVIDERS as readonly string[]).includes(p);
}

export function isTextCapability(c: AiCapability): c is TextCapability {
  return (TEXT_CAPABILITIES as readonly string[]).includes(c);
}

/** Map the legacy LLM_PROVIDER env value to the provider enum. */
export function deploymentDefaultProvider(): LlmProviderId | null {
  switch (env().LLM_PROVIDER) {
    case "anthropic":
      return "ANTHROPIC";
    case "openai":
      return "OPENAI";
    case "gemini":
      return "GEMINI";
    case "fixture":
      return "FIXTURE";
    default:
      return null;
  }
}

/** Platform-owned (deployment) LLM credentials that are actually configured. Keys never leave the server. */
export function deploymentLlmKey(provider: LlmProviderId): string | null {
  const e = env();
  switch (provider) {
    case "ANTHROPIC":
      return e.ANTHROPIC_API_KEY || null;
    case "OPENAI":
      return e.OPENAI_API_KEY || null;
    case "GEMINI":
      return e.GEMINI_API_KEY || null;
    case "FIXTURE":
      return fixturesAllowed() ? "fixture" : null;
  }
}

export function fixturesAllowed() {
  const e = env();
  return !!e.ALLOW_FIXTURE_PROVIDERS && e.APP_ENV !== "production";
}

/** Deployment speech provider for a capability (null = none / browser-only, which needs no grant). */
export function deploymentSpeechProvider(capability: SpeechCapability): AiProvider | null {
  const e = env();
  if (capability === "TRANSCRIPTION") {
    if (e.STT_PROVIDER === "openai") return "OPENAI";
    if (e.STT_PROVIDER === "deepgram") return "DEEPGRAM";
    if (e.STT_PROVIDER === "fixture") return "FIXTURE";
    return null;
  }
  if (e.TTS_PROVIDER === "openai") return "OPENAI";
  if (e.TTS_PROVIDER === "elevenlabs") return "ELEVENLABS";
  return null;
}

export const PERSONAL_SUBJECT = "PERSONAL";
