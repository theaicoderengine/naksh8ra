import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AMBIENT_SDK_ENV, createLlmAdapter } from "@/server/providers/llm";

/**
 * SDKs read many environment variables besides *_API_KEY (auth tokens, custom headers,
 * org/project ids, base URLs, Vertex settings). An organisation's own-key request must
 * carry NONE of the platform's environment configuration.
 */
const OVERRIDABLE_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: "sk-ant-PLATFORM-KEY",
  ANTHROPIC_AUTH_TOKEN: "PLATFORM-AUTH-TOKEN",
  ANTHROPIC_BASE_URL: "https://platform-proxy.internal",
  OPENAI_API_KEY: "sk-PLATFORM-KEY",
  OPENAI_ORG_ID: "org-PLATFORM",
  OPENAI_PROJECT_ID: "proj_PLATFORM",
  OPENAI_BASE_URL: "https://platform-proxy.internal/v1",
  GEMINI_API_KEY: "AIza-PLATFORM-KEY",
  GOOGLE_API_KEY: "AIza-PLATFORM-KEY",
  GOOGLE_GEMINI_BASE_URL: "https://platform-proxy.internal",
  GOOGLE_GENAI_USE_VERTEXAI: "true",
  GOOGLE_CLOUD_PROJECT: "platform-project",
  GOOGLE_CLOUD_LOCATION: "us-central1",
};

function withEnv(vars: Record<string, string>) {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterEach(() => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

describe("organisation-key requests are isolated from platform SDK environment", () => {
  withEnv(OVERRIDABLE_ENV);
  for (const provider of ["ANTHROPIC", "OPENAI", "GEMINI"] as const) {
    it(`${provider}: only the organisation's key, official endpoint, no platform headers`, async () => {
      const seen: { url: string; headers: Record<string, string> }[] = [];
      const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input instanceof Request ? input.url : input), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
        return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 401, headers: { "content-type": "application/json" } });
      };
      await createLlmAdapter(provider, "ORG-OWN-KEY-1234567890", { fetch: fetch as never }).verify("some-model").catch(() => undefined);
      expect(seen).toHaveLength(1); // no SDK-level retries
      const dump = JSON.stringify(seen);
      expect(dump).not.toMatch(/PLATFORM|platform-proxy|platform-project|aiplatform/);
      expect(dump).toContain("ORG-OWN-KEY-1234567890");
      expect(new URL(seen[0].url).host).toBe({ ANTHROPIC: "api.anthropic.com", OPENAI: "api.openai.com", GEMINI: "generativelanguage.googleapis.com" }[provider]);
    });
  }
});

describe("un-overridable SDK environment variables fail closed", () => {
  for (const name of AMBIENT_SDK_ENV) {
    describe(name, () => {
      withEnv({ [name]: name === "ANTHROPIC_CUSTOM_HEADERS" ? "x-platform-secret: PLATFORM-HDR" : "PLATFORM-VALUE" });
      it("refuses to create any AI client", () => {
        for (const p of ["ANTHROPIC", "OPENAI", "GEMINI"] as const) expect(() => createLlmAdapter(p, "ORG-OWN-KEY-1234567890")).toThrow(/configuration error/);
      });
    });
  }
});

describe("no automatic model switching", () => {
  it("Anthropic requests use exactly the selected model, with no provider-side fallback", async () => {
    const bodies: Record<string, unknown>[] = [];
    const urls: string[] = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input instanceof Request ? input.url : input));
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "x" } }), { status: 529, headers: { "content-type": "application/json" } });
    };
    const { z } = await import("zod/v4");
    await createLlmAdapter("ANTHROPIC", "ORG-OWN-KEY-1234567890", { fetch: fetch as never }).json({ purpose: "t", system: "s", user: "u", schema: z.object({ a: z.string() }) }, "claude-opus-5-5").catch(() => undefined);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].model).toBe("claude-opus-5-5");
    expect(bodies[0]).not.toHaveProperty("fallbacks");
    expect(urls[0]).not.toMatch(/beta=.*fallback/);
  });
});
