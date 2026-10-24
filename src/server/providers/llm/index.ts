import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z as z4 } from "zod/v4";
import { env } from "../../env";
import { AppError } from "../../errors";
import { logger } from "../../logger";
import { recordUsage, type UsageCtx } from "../usage";
import { fixtureJson, fixtureText } from "./fixture";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type JsonRequest<T> = {
  purpose: string; // e.g. "assessment.v3" — used for usage tracking & fixtures
  system: string;
  user: string;
  schema: z4.ZodType<T>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  usage: UsageCtx;
  fast?: boolean;
};

export type TextRequest = {
  purpose: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  usage: UsageCtx;
  fast?: boolean;
};

export interface LlmProvider {
  name: string;
  mode: "LIVE" | "FIXTURE";
  model(fast?: boolean): string;
  json<T>(req: JsonRequest<T>): Promise<{ data: T; model: string }>;
  text(req: TextRequest): Promise<{ text: string; model: string }>;
}

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
    throw new AppError("PROVIDER_ERROR", `${provider} returned malformed JSON`);
  }
  const res = schema.safeParse(parsed);
  if (!res.success) {
    logger.warn({ provider, issues: res.error.issues.slice(0, 5) }, "LLM output failed schema validation");
    throw new AppError("PROVIDER_ERROR", `${provider} output failed validation`);
  }
  return res.data;
}

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

class AnthropicProvider implements LlmProvider {
  name = "anthropic";
  mode = "LIVE" as const;
  private client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, timeout: env().AI_TIMEOUT_MS, maxRetries: 2 });
  model(fast?: boolean) {
    return fast ? env().ANTHROPIC_FAST_MODEL : env().ANTHROPIC_MODEL;
  }

  /** Uses the beta endpoint so eligible models get server-side refusal fallbacks. */
  private create(params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "betas" | "fallbacks">) {
    const fallback = FALLBACK_MODELS.has(params.model);
    return this.client.beta.messages.create({
      ...params,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  }

  async json<T>(req: JsonRequest<T>) {
    const model = this.model(req.fast);
    try {
      const res = await this.create({
        model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { format: { type: "json_schema", schema: toJsonSchema(req.schema) }, effort: req.effort ?? "medium" },
      });
      await recordUsage({ ...req.usage, kind: "LLM", provider: this.name, model: res.model, units: res.usage.input_tokens, unitLabel: "input_tokens" });
      await recordUsage({ ...req.usage, kind: "LLM", provider: this.name, model: res.model, units: res.usage.output_tokens, unitLabel: "output_tokens" });
      if (res.stop_reason === "refusal") throw new AppError("PROVIDER_ERROR", "The AI provider declined this request");
      if (res.stop_reason === "max_tokens") throw new AppError("PROVIDER_ERROR", "AI output was truncated");
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { data: parseOrThrow(req.schema, text, this.name), model: res.model };
    } catch (err) {
      throw wrap(err, this.name);
    }
  }

  async text(req: TextRequest) {
    const model = this.model(req.fast);
    try {
      const res = await this.create({
        model,
        max_tokens: req.maxTokens ?? 2000,
        system: req.system,
        messages: req.messages,
        output_config: { effort: "low" },
      });
      await recordUsage({ ...req.usage, kind: "LLM", provider: this.name, model: res.model, units: res.usage.input_tokens, unitLabel: "input_tokens" });
      await recordUsage({ ...req.usage, kind: "LLM", provider: this.name, model: res.model, units: res.usage.output_tokens, unitLabel: "output_tokens" });
      if (res.stop_reason === "refusal") throw new AppError("PROVIDER_ERROR", "The AI provider declined this request");
      return { text: res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim(), model: res.model };
    } catch (err) {
      throw wrap(err, this.name);
    }
  }
}

class OpenAiProvider implements LlmProvider {
  name = "openai";
  mode = "LIVE" as const;
  private client = new OpenAI({ apiKey: env().OPENAI_API_KEY, timeout: env().AI_TIMEOUT_MS, maxRetries: 2 });
  model() {
    return env().OPENAI_MODEL;
  }
  async json<T>(req: JsonRequest<T>) {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model(),
        max_completion_tokens: req.maxTokens ?? 8000,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        response_format: { type: "json_schema", json_schema: { name: req.purpose.replace(/[^a-zA-Z0-9_-]/g, "_"), strict: true, schema: toJsonSchema(req.schema) } },
      });
      await this.track(req.usage, res.model, res.usage);
      const choice = res.choices[0];
      if (choice?.message.refusal) throw new AppError("PROVIDER_ERROR", "The AI provider declined this request");
      return { data: parseOrThrow(req.schema, choice?.message.content ?? "", this.name), model: res.model };
    } catch (err) {
      throw wrap(err, this.name);
    }
  }
  async text(req: TextRequest) {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model(),
        max_completion_tokens: req.maxTokens ?? 1000,
        messages: [{ role: "system", content: req.system }, ...req.messages],
      });
      await this.track(req.usage, res.model, res.usage);
      return { text: res.choices[0]?.message.content?.trim() ?? "", model: res.model };
    } catch (err) {
      throw wrap(err, this.name);
    }
  }
  private async track(usage: UsageCtx, model: string, u?: { prompt_tokens: number; completion_tokens: number } | null) {
    if (!u) return;
    await recordUsage({ ...usage, kind: "LLM", provider: this.name, model, units: u.prompt_tokens, unitLabel: "input_tokens" });
    await recordUsage({ ...usage, kind: "LLM", provider: this.name, model, units: u.completion_tokens, unitLabel: "output_tokens" });
  }
}

/** Deterministic, offline provider for automated tests. Never enabled in production. */
class FixtureProvider implements LlmProvider {
  name = "fixture";
  mode = "FIXTURE" as const;
  model() {
    return "fixture-llm-v1";
  }
  async json<T>(req: JsonRequest<T>) {
    const data = fixtureJson(req.purpose, req.user);
    return { data: req.schema.parse(data), model: this.model() };
  }
  async text(req: TextRequest) {
    return { text: fixtureText(req.purpose, req.messages), model: this.model() };
  }
}

function wrap(err: unknown, provider: string): AppError {
  if (err instanceof AppError) return err;
  logger.error({ provider, err: err instanceof Error ? { name: err.name, message: err.message } : String(err) }, "LLM provider error");
  return new AppError("PROVIDER_ERROR", `The AI provider (${provider}) is unavailable. Please try again shortly.`);
}

let cached: LlmProvider | null = null;

export function llm(): LlmProvider {
  if (cached) return cached;
  const e = env();
  switch (e.LLM_PROVIDER) {
    case "anthropic":
      if (!e.ANTHROPIC_API_KEY) throw new AppError("PROVIDER_NOT_CONFIGURED", "AI is not configured: set ANTHROPIC_API_KEY");
      cached = new AnthropicProvider();
      break;
    case "openai":
      if (!e.OPENAI_API_KEY) throw new AppError("PROVIDER_NOT_CONFIGURED", "AI is not configured: set OPENAI_API_KEY");
      cached = new OpenAiProvider();
      break;
    case "fixture":
      if (!e.ALLOW_FIXTURE_PROVIDERS || e.APP_ENV === "production") throw new AppError("PROVIDER_NOT_CONFIGURED", "Fixture AI provider is only available in test environments");
      cached = new FixtureProvider();
      break;
    default:
      throw new AppError("PROVIDER_NOT_CONFIGURED", "AI is not configured on this deployment. An administrator must set LLM_PROVIDER and its API key.");
  }
  return cached;
}

export function llmStatus() {
  try {
    const p = llm();
    return { configured: true, provider: p.name, mode: p.mode, model: p.model() };
  } catch (e) {
    return { configured: false, provider: env().LLM_PROVIDER, mode: null, model: null, message: e instanceof Error ? e.message : String(e) };
  }
}

export function resetProviders() {
  cached = null;
}
