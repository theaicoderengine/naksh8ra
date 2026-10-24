"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "ready" | "recording" | "denied" | "unsupported";

function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) if (MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

/**
 * Microphone capture with a live input level (for the mic check and for
 * silence detection in conversational mode). Audio never leaves the browser
 * until the candidate submits an answer.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const ctx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const raf = useRef<number | null>(null);
  const started = useRef(0);
  const resolveStop = useRef<((b: Blob | null) => void) | null>(null);
  const silence = useRef<{ heard: boolean; quietSince: number | null; onSilence?: () => void; ms: number } | null>(null);

  const loop = useCallback(() => {
    if (!analyser.current) return;
    const buf = new Uint8Array(analyser.current.fftSize);
    analyser.current.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    const rms = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    setLevel(rms);
    if (rec.current?.state === "recording") {
      setElapsed(Date.now() - started.current);
      const s = silence.current;
      if (s) {
        if (rms > 0.08) {
          s.heard = true;
          s.quietSince = null;
        } else if (s.heard) {
          s.quietSince ??= Date.now();
          if (Date.now() - s.quietSince > s.ms) {
            silence.current = null;
            s.onSilence?.();
          }
        }
      }
    }
    raf.current = requestAnimationFrame(loop);
  }, []);

  const request = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || pickMime() === null) {
      setState("unsupported");
      return false;
    }
    setState("requesting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      ctx.current = new AudioContext();
      const src = ctx.current.createMediaStreamSource(stream.current);
      analyser.current = ctx.current.createAnalyser();
      analyser.current.fftSize = 1024;
      src.connect(analyser.current);
      raf.current = requestAnimationFrame(loop);
      setState("ready");
      return true;
    } catch {
      setState("denied");
      return false;
    }
  }, [loop]);

  const start = useCallback((opts: { stopOnSilenceMs?: number; onSilence?: () => void } = {}) => {
    if (!stream.current) return false;
    const mime = pickMime() || undefined;
    chunks.current = [];
    rec.current = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    rec.current.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.current.onstop = () => {
      const blob = chunks.current.length ? new Blob(chunks.current, { type: rec.current?.mimeType || "audio/webm" }) : null;
      resolveStop.current?.(blob);
      resolveStop.current = null;
      setState("ready");
    };
    silence.current = opts.stopOnSilenceMs ? { heard: false, quietSince: null, onSilence: opts.onSilence, ms: opts.stopOnSilenceMs } : null;
    started.current = Date.now();
    setElapsed(0);
    rec.current.start(250);
    setState("recording");
    return true;
  }, []);

  const stop = useCallback(() => {
    return new Promise<Blob | null>((resolve) => {
      if (!rec.current || rec.current.state !== "recording") return resolve(null);
      resolveStop.current = resolve;
      rec.current.stop();
    });
  }, []);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      stream.current?.getTracks().forEach((t) => t.stop());
      ctx.current?.close().catch(() => undefined);
    },
    [],
  );

  return { state, level, elapsed, request, start, stop };
}

/** Play server-synthesised audio, or fall back to the browser's speech synthesis. */
export function speak(text: string, audio: { audioBase64?: string | null; audioMime?: string | null } | null, lang = "en", onEnd?: () => void) {
  if (typeof window === "undefined") return () => undefined;
  if (audio?.audioBase64) {
    const a = new Audio(`data:${audio.audioMime ?? "audio/mpeg"};base64,${audio.audioBase64}`);
    a.onended = () => onEnd?.();
    a.play().catch(() => onEnd?.());
    return () => a.pause();
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.97;
    u.onend = () => onEnd?.();
    window.speechSynthesis.speak(u);
    return () => window.speechSynthesis.cancel();
  }
  onEnd?.();
  return () => undefined;
}
