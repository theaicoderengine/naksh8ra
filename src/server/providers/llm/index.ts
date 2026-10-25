import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI, type Fetch } from "@google/genai";
import { z as z4 } from "zod/v4";
import { env } from "../../env";
import { AppError } from "../../errors";
import { logger } from "../../logger";
import type { LlmProviderId } from "../../ai/catalog";
import { fixtureJson, fixtureText } from "./fixture";

/**
 * Stateless LLM adapters. A client is created per operation from the credential the
 * tenant-aware resolver (src/server/ai/access.ts) selected, so no long-lived instance
 * can carry one organisation's key into another organisation's request. Services must
 * not call these directly — use aiJson / aiText from the resolver.
 */

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type JsonRequest<T> = {
  purpose: string; // prompt version — used for fixtures and logs
  system: string;
  user: string;
  schema: z4.ZodType<T>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  fast?: boolean;
};

export type TextRequest = {
  purpose: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  fast?: boolean;
};

export type TokenUsage = { inputTokens: number | null; outputTokens: number | null };

export interface LlmAdapter {
  provider: LlmProviderId;
  mode: "LIVE" | "FIXTURE";
  json<T>(req: JsonRequest<T>, model: string): Promise<{ data: T; model: string; usage: TokenUsage }>;
  text(req: TextRequest, model: string): Promise<{ text: string; model: string; usage: TokenUsage }>;
  /** Connection test: authenticates and confirms the model is available to this key. No content is generated. */
  verify(model: string): Promise<void>;
}

export type AdapterOptions = { fetch?: Fetch; timeoutMs?: number; retryDelaySec?: { initial: number; max: number } };

function toJsonSchema(schema: z4.ZodType): Record<string, unknown> {
  const js = z4.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

function parseOrThrow<T>(schema: z4.ZodType<T>, raw: string, provider: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("PROVIDER_ERROR", `${provider} returned malformed JSON`, { reason: "invalid_output" });
  }
  const res = schema.safeParse(parsed);
  if (!res.success) {
    logger.warn({ provider, issues: res.error.issues.slice(0, 5).map((i) => ({ path: i.path, code: i.code })) }, "LLM output failed schema validation");
    throw new AppError("PROVIDER_ERROR", `${provider} output failed validation`, { reason: "invalid_output" });
  }
  return res.data;
}

const KEY_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{6,}/g, /sk-(?:proj-)?[A-Za-z0-9_-]{8,}/g, /AIza[0-9A-Za-z_-]{20,}/g, /\b[A-Za-z0-9_-]{32,}\b/g];

/** Remove anything that looks like a credential from provider error text before it is logged or stored. */
export function scrubSecrets(text: string, known: (string | null | undefined)[] = []): string {
  let out = text;
  for (const k of known) if (k && k.length >= 6) out = out.split(k).join("[REDACTED]");
  for (const re of KEY_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out.slice(0, 500);
}

const LABEL: Record<LlmProviderId, string> = { ANTHROPIC: "Anthropic", OPENAI: "OpenAI", GEMINI: "Gemini", FIXTURE: "Fixture" };

/**
 * Map SDK errors to platform errors. Quota/rate-limit errors are surfaced as-is: the
 * platform never retries them on another provider or model (in particular it never
 * moves a free-tier Gemini request onto a paid model).
 */
export function classifyProviderError(provider: LlmProviderId, err: unknown, apiKey?: string | null): AppError {
  if (err instanceof AppError) return err;
  const e = err as { status?: number; name?: string; message?: string; code?: string };
  const status = typeof e?.status === "number" ? e.status : null;
  const message = scrubSecrets(String(e?.message ?? err), [apiKey]);
  const label = LABEL[provider];
  logger.warn({ provider, status, name: e?.name, message }, "LLM provider error");
  if (status === 401 || status === 403) return new AppError("PROVIDER_ERROR", `${label} rejected the API key (not authorised). Check the key and its permissions.`, { reason: "auth", providerStatus: status });
  if (status === 404) return new AppError("PROVIDER_ERROR", `The selected model is not available to this ${label} key.`, { reason: "model_not_found", providerStatus: status });
  if (status === 429) {
    const msg =
      provider === "GEMINI"
        ? "Gemini quota or rate limit reached. Free-tier quotas are lower than paid-tier quotas; the request was not moved to another model. Try again later or review the project's plan in Google AI Studio."
        : `${label} rate limit or quota reached. Try again later.`;
    return new AppError("PROVIDER_QUOTA_EXCEEDED", msg, { reason: "quota", providerStatus: status });
  }
  if (status === 400) return new AppError("PROVIDER_ERROR", `${label} rejected the request (${message.slice(0, 160)})`, { reason: "bad_request", providerStatus: status });
  const timeout = /timeout|timed out|abort/i.test(`${e?.name} ${e?.message}`);
  return new AppError("PROVIDER_ERROR", `The AI provider (${label}) is ${timeout ? "not responding" : "unavailable"}. Please try again shortly.`, { reason: timeout ? "timeout" : "unavailable", providerStatus: status });
}

function requireKey(apiKey: string | null | undefined): string {
  // SDKs fall back to their own *_API_KEY environment variable when no key is passed.
  // An empty key must never reach them, or an organisation could silently use the
  // platform's credential.
  if (!apiKey || !apiKey.trim()) throw new AppError("PROVIDER_NOT_CONFIGURED", "No API key available for this provider");
  return apiKey.trim();
}

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

class AnthropicAdapter implements LlmAdapter {
  provider = "ANTHROPIC" as const;
  mode = "LIVE" as const;
  private client: Anthropic;
  constructor(private apiKey: string, opts: AdapterOptions) {
    this.client = new Anthropic({ apiKey: requireKey(apiKey), timeout: opts.timeoutMs ?? env().AI_TIMEOUT_MS, maxRetries: 2, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  }

  /** Uses the beta endpoint so eligible models get server-side refusal fallbacks (same model family, decided by the provider). */
  private create(params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "betas" | "fallbacks">) {
    const fallback = FALLBACK_MODELS.has(params.model);
    return this.client.beta.messages.create({
      ...params,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  }

  async json<T>(req: JsonRequest<T>, model: string) {
    try {
      const res = await this.create({
        model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { format: { type: "json_schema", schema: toJsonSchema(req.schema) }, effort: req.effort ?? "medium" },
      });
      const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
      if (res.stop_reason === "refusal") throw new AppError("PROVIDER_ERROR", "The AI provider declined this request", { reason: "refusal", usage });
      if (res.stop_reason === "max_tokens") throw new AppError("PROVIDER_ERROR", "AI output was truncated", { reason: "truncated", usage });
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { data: parseOrThrow(req.schema, text, "Anthropic"), model: res.model, usage };
    } catch (err) {
      throw classifyProviderError(this.provider, err, this.apiKey);
    }
  }

  async text(req: TextRequest, model: string) {
    try {
      const res = await this.create({ model, max_tokens: req.maxTokens ?? 2000, system: req.system, messages: req.messages, output_config: { effort: "low" } });
      const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
      if (res.stop_reason === "refusal") throw new AppError("PROVIDER_ERROR", "The AI provider declined this request", { reason: "refusal", usage });
      return { text: res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim(), model: res.model, usage };
    } catch (err) {
      throw classifyProviderError(this.provider, err, this.apiKey);
    }
  }

  async verify(model: string) {
    try {
      await this.client.models.retrieve(model);
    } catch (err) {
      throw classifyProviderError(this.provider, err, this.apiKey);
    }
  }
}

class OpenAiAdapter implements LlmAdapter {
  provider = "OPENAI" as const;
  mode = "LIVE" as const;
  private client: OpenAI;
  constructor(private apiKey: string, opts: AdapterOptions) {
    this.client = new OpenAI({ apiKey: requireKey(apiKey), timeout: opts.timeoutMs ?? env().AI_TIMEOUT_MS, maxRetries: 2, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  }
  async json<T>(req: JsonRequest<T>, model: string) {
    try {
      const res = await this.client.chat.completions.create({
        model,
        max_completion_tokens: req.maxTokens ?? 8000,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        response_format: { type: "json_schema", json_schema: { name: req.purpose.replace(/[^a-zA-Z0-9_-]/g, "_"), strict: true, schema: toJsonSchema(req.schema) } },
      });
      const usage = { inputTokens: res.usage?.prompt_tokens ?? null, outputTokens: res.usage?.completion_tokens ?? null };
      const choice = res.choices[0];
      if (choice?.message.refusal) throw new AppError("PROVIDER_ERROR", "The AI provider declined this request", { reason: "refusal", usage });
      if (choice?.finish_reason === "length") throw new AppError("PROVIDER_ERROR", "AI output was truncated", { reason: "truncated", usage });
      return { data: parseOrThrow(req.schema, choice?.message.content ?? "", "OpenAI"), model: res.model, usage };
    } catch (err) {
      throw classifyProviderError(this.provider, err, this.apiKey);
    }
  }
  async text(req: TextRequest, model: string) {
    try {
      const res = await this.client.chat.completions.create({ model, max_completion_tokens: req.maxTokens ?? 1000, messages: [{ role: "system", content: req.system }, ...req.messages] });
      return { text: res.choices[0]?.message.content?.trim() ?? "", model: res.model, usage: { inputTokens: res.usage?.prompt_tokens ?? null, outputTokens: res.usage?.completion_tokens ?? null } };
    } catch (err) {
      throw classifyProviderError(this.provider, err, this.apiKey);
    }
  }
  async verify(model: string) {
    try {
      await this.client.models.retrieve(model);
    } catch (err) {
      throw classifyProviderError(this.provider, err, this.apiKey);
    }
  }
}

/** Google Gemini API (AI Studio key) via the official @google/genai SDK. */
export class GeminiAdapter implements LlmAdapter {
  provider = "GEMINI" as const;
  mode = "LIVE" as const;
  private client: GoogleGenAI;
  constructor(private apiKey: string, opts: AdapterOptions) {
    this.client = new GoogleGenAI({
      apiKey: requireKey(apiKey),
      vertexai: false, // never pick up Vertex/ADC credentials from the environment
      httpOptions: {
        timeout: opts.timeoutMs ?? env().AI_TIMEOUT_MS,
        // Transient errors only. 429 (quota/rate limit) is deliberately NOT retried so a
        // free-tier quota is not burned by retries; it is reported to the caller instead.
        retryOptions: { attempts: 3, initialDelay: opts.retryDelaySec?.initial ?? 1, maxDelay: opts.retryDelaySec?.max ?? 8, httpStatusCodes: [408, 500, 502, 503, 504] },
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      },
    });
  }

  private check(res: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>) {
    const usage = { inputTokens: res.usageMetadata?.promptTokenCount ?? null, outputTokens: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0) || null };
    if (res.promptFeedback?.blockReason) throw new AppError("PROVIDER_ERROR", "The AI provider declined this request", { reason: "refusal", usage });
    const finish = res.candidates?.[0]?.finishReason;
    if (finish === "SAFETY" || finish === "RECITATION" || finish === "PROHIBITED_CONTENT" || finish === "BLOCKLIST" || finish === "SPII") throw new AppError("PROVIDER_ERROR", "The AI provider declined this request", { reason: "refusal", usage });
    if (finish === "MAX_TOKENS") throw new AppError("PROVIDER_ERROR", "AI output was truncated", { reason: "truncated", usage });
    return usage;
  }

  async json<T>(req: JsonRequest<T>, model: string) {
    try {
      const res = await this.client.models.generateContent({
        model,
        contents: req.user,
        config: { systemInstruction: req.system, responseMimeType: "application/json", responseJsonSchema: toJsonSchema(req.schema), maxOutputTokens: req.maxTokens ?? 8192 },
      });
      const usage = this.check(res);
      return { data: parseOrThrow(req.schema, res.text ?? "", "Gemini"), model: res.modelVersion ?? model, usage };
    } catch (err) {
      throw classifyProviderError(this.provider, err, this.apiKey);
    }
  }

  async text(req: TextRequest, model: string) {
    try {
      const res = await this.client.models.generateContent({
        model,
        contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        config: { systemInstruction: req.system, maxOutputTokens: req.maxTokens ?? 1000 },
      });
      const usage = this.check(res);
      return { text: (res.text ?? "").trim(), model: res.modelVersion ?? model, usage };
    } catch (err) {
      throw classifyProviderError(this.provider, err, this.apiKey);
    }
  }

  async verify(model: string) {
    try {
      const m = await this.client.models.get({ model });
      if (m.supportedActions && !m.supportedActions.includes("generateContent")) {
        throw new AppError("PROVIDER_ERROR", "This Gemini model does not support text generation", { reason: "unsupported_model" });
      }
    } catch (err) {
      throw classifyProviderError(this.provider, err, this.apiKey);
    }
  }
}

/**
 * Deterministic, offline adapter for automated tests. Never available in production.
 * Test keys: "fixture-ok" works; "fixture-quota" simulates a provider quota error;
 * "fixture-bad" simulates a rejected key. The platform fixture credential is "fixture".
 */
class FixtureAdapter implements LlmAdapter {
  provider = "FIXTURE" as const;
  mode = "FIXTURE" as const;
  constructor(private apiKey: string) {}
  private simulate() {
    if (this.apiKey === "fixture-quota") throw classifyProviderError("FIXTURE", Object.assign(new Error("Resource exhausted"), { status: 429 }));
    if (this.apiKey === "fixture-bad") throw classifyProviderError("FIXTURE", Object.assign(new Error("API key not valid"), { status: 401 }));
  }
  async json<T>(req: JsonRequest<T>, model: string) {
    this.simulate();
    return { data: req.schema.parse(fixtureJson(req.purpose, req.user)), model, usage: { inputTokens: 100, outputTokens: 50 } };
  }
  async text(req: TextRequest, model: string) {
    this.simulate();
    return { text: fixtureText(req.purpose, req.messages), model, usage: { inputTokens: 50, outputTokens: 20 } };
  }
  async verify(model: string) {
    this.simulate();
    if (!["fixture", "fixture-ok"].includes(this.apiKey)) throw classifyProviderError("FIXTURE", Object.assign(new Error("API key not valid"), { status: 401 }));
    if (model !== "fixture-llm-v1") throw classifyProviderError("FIXTURE", Object.assign(new Error("model not found"), { status: 404 }));
  }
}

export function createLlmAdapter(provider: LlmProviderId, apiKey: string, opts: AdapterOptions = {}): LlmAdapter {
  switch (provider) {
    case "ANTHROPIC":
      return new AnthropicAdapter(apiKey, opts);
    case "OPENAI":
      return new OpenAiAdapter(apiKey, opts);
    case "GEMINI":
      return new GeminiAdapter(apiKey, opts);
    case "FIXTURE": {
      const e = env();
      if (!e.ALLOW_FIXTURE_PROVIDERS || e.APP_ENV === "production") throw new AppError("PROVIDER_NOT_CONFIGURED", "Fixture AI provider is only available in test environments");
      return new FixtureAdapter(apiKey);
    }
  }
}
