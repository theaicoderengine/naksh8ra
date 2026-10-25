import OpenAI, { toFile } from "openai";
import { env } from "../env";
import { attemptTimeoutMs, hasDeadline } from "../deadline";
import { AppError } from "../errors";
import { logger } from "../logger";
import { recordUsage, type UsageCtx } from "./usage";

export type Transcription = {
  text: string;
  segments: { startMs: number; endMs: number; text: string }[];
  durationMs: number | null;
  provider: string;
  mode: "LIVE" | "FIXTURE";
};

export interface SttProvider {
  name: string;
  mode: "LIVE" | "FIXTURE";
  transcribe(audio: Buffer, mime: string, language: string, usage: UsageCtx): Promise<Transcription>;
}

class OpenAiStt implements SttProvider {
  name = "openai";
  mode = "LIVE" as const;
  private client = new OpenAI({ apiKey: env().OPENAI_API_KEY, timeout: env().AI_TIMEOUT_MS, maxRetries: 2 });
  async transcribe(audio: Buffer, mime: string, language: string, usage: UsageCtx): Promise<Transcription> {
    try {
      const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("wav") ? "wav" : "webm";
      const res = (await this.client.audio.transcriptions.create({
        file: await toFile(audio, `answer.${ext}`, { type: mime }),
        model: env().OPENAI_STT_MODEL,
        language: language.slice(0, 2),
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      }, { timeout: attemptTimeoutMs(env().AI_TIMEOUT_MS), maxRetries: hasDeadline() ? 0 : 2 })) as unknown as { text: string; duration?: number; segments?: { start: number; end: number; text: string }[] };
      const durationMs = res.duration ? Math.round(res.duration * 1000) : null;
      await recordUsage({ ...usage, kind: "STT", provider: this.name, model: env().OPENAI_STT_MODEL, units: (durationMs ?? 0) / 1000, unitLabel: "seconds" });
      return {
        text: res.text.trim(),
        segments: (res.segments ?? []).map((s) => ({ startMs: Math.round(s.start * 1000), endMs: Math.round(s.end * 1000), text: s.text.trim() })),
        durationMs,
        provider: this.name,
        mode: "LIVE",
      };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "STT failed");
      throw new AppError("PROVIDER_ERROR", "Speech recognition is temporarily unavailable");
    }
  }
}

class DeepgramStt implements SttProvider {
  name = "deepgram";
  mode = "LIVE" as const;
  async transcribe(audio: Buffer, mime: string, language: string, usage: UsageCtx): Promise<Transcription> {
    const res = await fetch(`https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&utterances=true&language=${encodeURIComponent(language)}`, {
      method: "POST",
      headers: { authorization: `Token ${env().DEEPGRAM_API_KEY}`, "content-type": mime },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(attemptTimeoutMs(env().AI_TIMEOUT_MS)),
    });
    if (!res.ok) throw new AppError("PROVIDER_ERROR", "Speech recognition is temporarily unavailable");
    const json = (await res.json()) as {
      metadata?: { duration?: number };
      results?: { channels?: { alternatives?: { transcript: string }[] }[]; utterances?: { start: number; end: number; transcript: string }[] };
    };
    const durationMs = json.metadata?.duration ? Math.round(json.metadata.duration * 1000) : null;
    await recordUsage({ ...usage, kind: "STT", provider: this.name, model: "nova-2", units: (durationMs ?? 0) / 1000, unitLabel: "seconds" });
    return {
      text: json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "",
      segments: (json.results?.utterances ?? []).map((u) => ({ startMs: Math.round(u.start * 1000), endMs: Math.round(u.end * 1000), text: u.transcript })),
      durationMs,
      provider: this.name,
      mode: "LIVE",
    };
  }
}

const FIXTURE_ANSWERS = [
  "In my last project I led the migration of our reporting system. I analysed the bottlenecks, proposed two options to the team, and we cut report generation time by half.",
  "When two colleagues disagreed about priorities I set up a short meeting, we listed the trade-offs together, and agreed a plan that met the release date.",
  "I take ownership by writing down what I committed to, checking progress weekly, and telling stakeholders early if something slips.",
];

/** Test-only STT: returns deterministic text. Never enabled in production. */
class FixtureStt implements SttProvider {
  name = "fixture";
  mode = "FIXTURE" as const;
  async transcribe(audio: Buffer): Promise<Transcription> {
    const text = FIXTURE_ANSWERS[audio.length % FIXTURE_ANSWERS.length];
    return { text, segments: [{ startMs: 0, endMs: 8000, text }], durationMs: 8000, provider: this.name, mode: "FIXTURE" };
  }
}

let stt: SttProvider | null = null;
export function sttProvider(): SttProvider {
  if (stt) return stt;
  const e = env();
  switch (e.STT_PROVIDER) {
    case "openai":
      if (!e.OPENAI_API_KEY) throw new AppError("PROVIDER_NOT_CONFIGURED", "Speech recognition is not configured: set OPENAI_API_KEY");
      stt = new OpenAiStt();
      break;
    case "deepgram":
      if (!e.DEEPGRAM_API_KEY) throw new AppError("PROVIDER_NOT_CONFIGURED", "Speech recognition is not configured: set DEEPGRAM_API_KEY");
      stt = new DeepgramStt();
      break;
    case "fixture":
      if (!e.ALLOW_FIXTURE_PROVIDERS || e.APP_ENV === "production") throw new AppError("PROVIDER_NOT_CONFIGURED", "Fixture STT is only available in tests");
      stt = new FixtureStt();
      break;
    default:
      throw new AppError("PROVIDER_NOT_CONFIGURED", "Speech recognition is not configured on this deployment (STT_PROVIDER).");
  }
  return stt;
}

// ───────────── Text-to-speech ─────────────
export interface TtsProvider {
  name: string;
  /** Returns audio bytes, or null when synthesis happens in the browser (Web Speech API). */
  synthesize(text: string, voice: string | null, usage: UsageCtx): Promise<{ audio: Buffer; mime: string } | null>;
}

class BrowserTts implements TtsProvider {
  name = "browser";
  async synthesize() {
    return null;
  }
}

class OpenAiTts implements TtsProvider {
  name = "openai";
  private client = new OpenAI({ apiKey: env().OPENAI_API_KEY, timeout: env().AI_TIMEOUT_MS, maxRetries: 2 });
  async synthesize(text: string, voice: string | null, usage: UsageCtx) {
    try {
      const res = await this.client.audio.speech.create({ model: env().OPENAI_TTS_MODEL, voice: (voice ?? env().OPENAI_TTS_VOICE) as "alloy", input: text.slice(0, 4000), response_format: "mp3" }, { timeout: attemptTimeoutMs(env().AI_TIMEOUT_MS), maxRetries: hasDeadline() ? 0 : 2 });
      await recordUsage({ ...usage, kind: "TTS", provider: this.name, model: env().OPENAI_TTS_MODEL, units: text.length, unitLabel: "characters" });
      return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "TTS failed");
      throw new AppError("PROVIDER_ERROR", "Voice synthesis is temporarily unavailable");
    }
  }
}

class ElevenLabsTts implements TtsProvider {
  name = "elevenlabs";
  async synthesize(text: string, voice: string | null, usage: UsageCtx) {
    const voiceId = voice ?? env().ELEVENLABS_VOICE_ID;
    if (!voiceId) throw new AppError("PROVIDER_NOT_CONFIGURED", "ELEVENLABS_VOICE_ID is not configured");
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: { "xi-api-key": env().ELEVENLABS_API_KEY!, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: text.slice(0, 4000), model_id: "eleven_multilingual_v2" }),
      signal: AbortSignal.timeout(attemptTimeoutMs(env().AI_TIMEOUT_MS)),
    });
    if (!res.ok) throw new AppError("PROVIDER_ERROR", "Voice synthesis is temporarily unavailable");
    await recordUsage({ ...usage, kind: "TTS", provider: this.name, units: text.length, unitLabel: "characters" });
    return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
  }
}

let tts: TtsProvider | null = null;
export function ttsProvider(): TtsProvider {
  if (tts) return tts;
  const e = env();
  if (e.TTS_PROVIDER === "openai") {
    if (!e.OPENAI_API_KEY) throw new AppError("PROVIDER_NOT_CONFIGURED", "TTS is not configured: set OPENAI_API_KEY");
    tts = new OpenAiTts();
  } else if (e.TTS_PROVIDER === "elevenlabs") {
    if (!e.ELEVENLABS_API_KEY) throw new AppError("PROVIDER_NOT_CONFIGURED", "TTS is not configured: set ELEVENLABS_API_KEY");
    tts = new ElevenLabsTts();
  } else {
    tts = new BrowserTts();
  }
  return tts;
}

export function speechStatus() {
  const s = (() => {
    try {
      const p = sttProvider();
      return { configured: true, provider: p.name, mode: p.mode };
    } catch (e) {
      return { configured: false, provider: env().STT_PROVIDER, mode: null, message: (e as Error).message };
    }
  })();
  const t = (() => {
    try {
      return { configured: true, provider: ttsProvider().name };
    } catch (e) {
      return { configured: false, provider: env().TTS_PROVIDER, message: (e as Error).message };
    }
  })();
  return { stt: s, tts: t };
}

export function resetSpeechProviders() {
  stt = null;
  tts = null;
}
