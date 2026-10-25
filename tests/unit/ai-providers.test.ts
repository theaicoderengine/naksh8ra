import { describe, it, expect, afterEach } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { z as z4 } from "zod/v4";
import { GeminiAdapter, classifyProviderError, createLlmAdapter, scrubSecrets } from "@/server/providers/llm";
import { findModel, modelCatalog } from "@/server/ai/catalog";
import { REDACT_PATHS } from "@/server/logger";
import { AppError } from "@/server/errors";

type Call = { url: string; body: string; headers: Record<string, string> };

/** Fake transport for the official @google/genai SDK: the real SDK code runs, only HTTP is stubbed. */
function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), body: String(init?.body ?? ""), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { fn, calls };
}

const KEY = "AIzaSyTESTKEY-not-real-0000000000";
const Schema = z4.object({ answer: z4.string(), score: z4.number() });
const req = { purpose: "test.v1", system: "You are a test.", user: "Say hi", schema: Schema };
const gemini = (f: ReturnType<typeof fakeFetch>) => new GeminiAdapter(KEY, { fetch: f.fn as never });

describe("Gemini adapter (official SDK, fake transport)", () => {
  it("requests structured JSON output and returns parsed data with token usage", async () => {
    const f = fakeFetch([{ status: 200, body: { candidates: [{ content: { role: "model", parts: [{ text: '{"answer":"hi","score":3}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 }, modelVersion: "gemini-2.5-flash" } }]);
    const out = await gemini(f).json(req, "gemini-2.5-flash");
    expect(out.data).toEqual({ answer: "hi", score: 3 });
    expect(out.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(f.calls[0].url).toContain("/models/gemini-2.5-flash:generateContent");
    const body = JSON.parse(f.calls[0].body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.properties.answer).toBeTruthy();
    // The key travels in a header, not the URL (so it never lands in access logs).
    expect(f.calls[0].url).not.toContain(KEY);
    expect(f.calls[0].headers["x-goog-api-key"]).toBe(KEY);
  });

  it("maps a 429 to PROVIDER_QUOTA_EXCEEDED with free-tier guidance, without retrying or switching model", async () => {
    const f = fakeFetch([{ status: 429, body: { error: { code: 429, message: `Resource has been exhausted (e.g. check quota). key=${KEY}`, status: "RESOURCE_EXHAUSTED" } } }]);
    const err = await gemini(f).json(req, "gemini-2.5-flash").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("PROVIDER_QUOTA_EXCEEDED");
    expect(err.message).toMatch(/Free-tier quotas are lower/);
    expect(err.message).toMatch(/not moved to another model/);
    expect(f.calls).toHaveLength(1); // quota is not burned by retries
    expect(f.calls.every((c) => c.url.includes("gemini-2.5-flash:"))).toBe(true);
    expect(JSON.stringify(err)).not.toContain(KEY);
  });

  it("reports transient 5xx errors as retryable without retrying inside the SDK (the resolver retries, reserving limits per attempt)", async () => {
    const f = fakeFetch([{ status: 503, body: { error: { code: 503, message: "overloaded", status: "UNAVAILABLE" } } }]);
    const err = await gemini(f).json(req, "gemini-2.5-flash").catch((e) => e);
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(err.details.reason).toBe("unavailable");
    expect(f.calls).toHaveLength(1);
  });

  it("rejected keys are reported as authentication failures", async () => {
    const f = fakeFetch([{ status: 403, body: { error: { code: 403, message: "API key not valid. Please pass a valid API key.", status: "PERMISSION_DENIED" } } }]);
    const err = await gemini(f).verify("gemini-2.5-flash").catch((e) => e);
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(err.details.reason).toBe("auth");
  });

  it("connection test confirms the model supports generateContent", async () => {
    const ok = fakeFetch([{ status: 200, body: { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent", "countTokens"] } }]);
    await expect(gemini(ok).verify("gemini-2.5-flash")).resolves.toBeUndefined();
    const embed = fakeFetch([{ status: 200, body: { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] } }]);
    const err = await gemini(embed).verify("text-embedding-004").catch((e) => e);
    expect(err.details.reason).toBe("unsupported_model");
    const missing = fakeFetch([{ status: 404, body: { error: { code: 404, message: "models/nope is not found", status: "NOT_FOUND" } } }]);
    expect((await gemini(missing).verify("nope").catch((e) => e)).details.reason).toBe("model_not_found");
  });

  it("treats safety blocks and truncation as failures, never as results", async () => {
    const blocked = fakeFetch([{ status: 200, body: { candidates: [{ content: { role: "model", parts: [] }, finishReason: "SAFETY" }] } }]);
    expect((await gemini(blocked).json(req, "gemini-2.5-flash").catch((e) => e)).details.reason).toBe("refusal");
    const cut = fakeFetch([{ status: 200, body: { candidates: [{ content: { role: "model", parts: [{ text: '{"answer":' }] }, finishReason: "MAX_TOKENS" }] } }]);
    expect((await gemini(cut).json(req, "gemini-2.5-flash").catch((e) => e)).details.reason).toBe("truncated");
    const bad = fakeFetch([{ status: 200, body: { candidates: [{ content: { role: "model", parts: [{ text: '{"answer":5}' }] }, finishReason: "STOP" }] } }]);
    expect((await gemini(bad).json(req, "gemini-2.5-flash").catch((e) => e)).details.reason).toBe("invalid_output");
  });
});

describe("credential safety in adapters", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("never lets an SDK fall back to the platform's *_API_KEY environment variable", () => {
    process.env.OPENAI_API_KEY = "sk-platform-owned-key-should-not-be-used";
    process.env.ANTHROPIC_API_KEY = "sk-ant-platform-owned-key";
    process.env.GEMINI_API_KEY = "AIzaPlatformOwnedKey000000000000";
    process.env.GOOGLE_API_KEY = "AIzaPlatformOwnedKey000000000000";
    for (const p of ["OPENAI", "ANTHROPIC", "GEMINI"] as const) {
      for (const k of ["", "   "]) {
        expect(() => createLlmAdapter(p, k)).toThrow(/No API key available/);
      }
    }
  });

  it("scrubs keys from provider error text before logging or storing", () => {
    const text = "Incorrect API key provided: sk-proj-abcDEF1234567890xyz. Also AIzaSyA1234567890abcdefghijklmnop and sk-ant-api03-zzzzzzzz";
    const out = scrubSecrets(text, ["my-own-literal-key-123"]);
    expect(out).not.toMatch(/sk-proj-abc|AIzaSyA123|sk-ant-api03/);
    expect(scrubSecrets("value my-own-literal-key-123 here", ["my-own-literal-key-123"])).toBe("value [REDACTED] here");
    const e = classifyProviderError("OPENAI", Object.assign(new Error("401 Incorrect API key provided: sk-proj-abcDEF1234567890xyz"), { status: 401 }), "sk-proj-abcDEF1234567890xyz");
    expect(e.message).not.toContain("sk-proj");
    expect(e.details).toMatchObject({ reason: "auth" });
  });

  it("logger redacts API keys, encrypted keys and provider key headers", () => {
    const lines: string[] = [];
    const log = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, new Writable({ write(c, _e, cb) { lines.push(c.toString()); cb(); } }));
    log.info({ apiKey: "sk-1", cred: { apiKey: "sk-2", encryptedKey: "v1:abc" }, req: { headers: { "x-goog-api-key": "AIza-3", "x-api-key": "sk-ant-4" } } }, "provider call");
    const out = lines.join("");
    for (const s of ["sk-1", "sk-2", "v1:abc", "AIza-3", "sk-ant-4"]) expect(out).not.toContain(s);
  });
});

describe("model catalogue", () => {
  const saved = process.env.AI_MODEL_CATALOG_JSON;
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_MODEL_CATALOG_JSON;
    else process.env.AI_MODEL_CATALOG_JSON = saved;
  });

  it("labels free-tier eligibility without promising it, and rejects unknown models", () => {
    expect(findModel("GEMINI", "gemini-2.5-flash")?.freeTier).toBe("ELIGIBLE");
    expect(findModel("ANTHROPIC", "claude-opus-5-5")?.freeTier).toBe("PAID_ONLY");
    expect(findModel("OPENAI", "gpt-imaginary-9")).toBeNull();
    expect(findModel("GEMINI", "claude-opus-5-5")).toBeNull(); // models are provider-scoped
  });

  it("is configurable: operators can add, re-label or remove models", () => {
    process.env.AI_MODEL_CATALOG_JSON = JSON.stringify([
      { provider: "GEMINI", id: "gemini-next-preview", freeTier: "UNKNOWN" },
      { provider: "GEMINI", id: "gemini-2.5-pro", freeTier: "PAID_ONLY" },
      { provider: "OPENAI", id: "gpt-4.1-mini", remove: true },
    ]);
    expect(findModel("GEMINI", "gemini-next-preview")).not.toBeNull();
    expect(findModel("GEMINI", "gemini-2.5-pro")?.freeTier).toBe("PAID_ONLY");
    expect(findModel("OPENAI", "gpt-4.1-mini")).toBeNull();
    process.env.AI_MODEL_CATALOG_JSON = "{not json";
    expect(modelCatalog().length).toBeGreaterThan(3); // invalid override is ignored, not fatal
  });
});
