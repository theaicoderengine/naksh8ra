"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2, RotateCcw, Keyboard, CheckCircle2, WifiOff, Clock, ShieldCheck, AlertTriangle } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "../ui/button";
import { Card, CardBody } from "../ui/card";
import { Alert } from "../ui/feedback";
import { Checkbox, Field, Textarea } from "../ui/form";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/spinner";
import { useRecorder, speak } from "./use-recorder";

type State = {
  status: string; providerMode: string; providers: { ready: boolean; message: string | null }; organisation: string; jobTitle: string; mode: "STRUCTURED_AUDIO" | "REALTIME_CONVERSATIONAL"; language: string;
  durationMinutes: number; questionCount: number; answerSeconds: number; prepSeconds: number; retakesAllowed: number; canRetakeLast: boolean; recordAudio: boolean; storeTranscript: boolean; allowTypedAnswers: boolean; captions: boolean; allowResume: boolean;
  instructions: string | null; expiresAt: string | null; progress: { answered: number; total: number }; currentQuestion: { position: number; prompt: string; answerSeconds: number } | null; conversation: { role: string; text: string }[]; ttsMode: "browser" | "server";
};
type Audio = { audioBase64?: string | null; audioMime?: string | null };

/** Interview API client bound to the candidate's credential (token or owning account). */
function useInterviewApi(ref: { token?: string; invitationId?: string }) {
  return useCallback(
    async <T,>(path: string, opts: { body?: unknown; form?: FormData } = {}): Promise<T> => {
      const headers: Record<string, string> = { accept: "application/json" };
      if (ref.token) headers["x-interview-token"] = ref.token;
      let body: BodyInit | undefined;
      if (opts.form) body = opts.form;
      else if (opts.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(opts.body);
      }
      const qs = ref.invitationId ? `?invitation=${encodeURIComponent(ref.invitationId)}` : "";
      const res = await fetch(`/api/v1/interview-session/${path}${qs}`, { method: body || path !== "state" ? "POST" : "GET", headers, body, credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(json?.error?.code ?? "INTERNAL", json?.error?.message ?? "Something went wrong", res.status);
      return json.data as T;
    },
    [ref.token, ref.invitationId],
  );
}

function fmtSecs(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function LevelMeter({ level }: { level: number }) {
  return (
    <div className="flex h-8 items-end gap-0.5" aria-hidden="true">
      {Array.from({ length: 20 }, (_, i) => <span key={i} className={`w-1.5 rounded-sm ${level * 20 > i ? "bg-success" : "bg-muted"}`} style={{ height: `${30 + i * 3.5}%` }} />)}
    </div>
  );
}

export function InterviewRoom({ token, invitationId }: { token?: string; invitationId?: string }) {
  const call = useInterviewApi({ token, invitationId });
  const rec = useRecorder();
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [typed, setTyped] = useState(false);
  const [text, setText] = useState("");
  const [take, setTake] = useState<{ blob: Blob; url: string; ms: number } | null>(null);
  const [question, setQuestion] = useState<State["currentQuestion"]>(null);
  const [last, setLast] = useState<State["currentQuestion"]>(null);
  const [retakeMode, setRetakeMode] = useState(false);
  const [prep, setPrep] = useState(0);
  const [interviewer, setInterviewer] = useState<string | null>(null);
  const [turns, setTurns] = useState<{ role: string; text: string }[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [consent, setConsent] = useState({ recording: true, aiAssessment: false, transcript: false, accommodation: "" });
  const [alternative, setAlternative] = useState(false);
  const [micTest, setMicTest] = useState<string | null>(null);
  const stopSpeech = useRef<() => void>(() => undefined);
  const idem = useRef(0);

  const load = useCallback(async () => {
    try {
      const st = await call<State>("state");
      setS(st);
      setQuestion(st.currentQuestion);
      setTurns(st.conversation);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load the interview");
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => {
      setOffline(false);
      call("event", { body: { type: "RECONNECT", data: {} } }).catch(() => undefined);
    };
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, [call]);

  // Structured mode: auto-stop when the answer time runs out.
  useEffect(() => {
    const q = retakeMode ? last : question;
    if (rec.state === "recording" && q && rec.elapsed >= q.answerSeconds * 1000) void finishRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.elapsed, rec.state, question, last, retakeMode]);

  // Preparation countdown.
  useEffect(() => {
    if (prep <= 0) return;
    const t = setTimeout(() => setPrep((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [prep]);

  function say(textToSay: string, audio: Audio | null, then?: () => void) {
    stopSpeech.current();
    setSpeaking(true);
    stopSpeech.current = speak(textToSay, audio, s?.language ?? "en", () => {
      setSpeaking(false);
      then?.();
    });
  }

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setErr(null);
    try {
      return await fn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong. Your progress is saved — please try again.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function finishRecording() {
    const blob = await rec.stop();
    if (!blob) return;
    if (s?.mode === "REALTIME_CONVERSATIONAL") return sendTurn(blob);
    setTake({ blob, url: URL.createObjectURL(blob), ms: rec.elapsed });
  }

  async function submitAnswer() {
    const retake = retakeMode;
    const target = retake ? last : question;
    if (!target) return;
    const form = new FormData();
    form.append("position", String(target.position));
    form.append("idempotencyKey", `${target.position}-${retake ? "r" : "a"}-${++idem.current}-${Date.now()}`);
    if (retake) form.append("retake", "true");
    if (typed) form.append("text", text);
    else if (take) {
      form.append("file", take.blob, `answer.${take.blob.type.includes("mp4") ? "m4a" : take.blob.type.includes("ogg") ? "ogg" : "webm"}`);
      form.append("durationMs", String(take.ms));
    }
    const r = await run(() => call<{ done: boolean; question: State["currentQuestion"] } & Audio>("answer", { form }));
    if (!r) return;
    setTake(null);
    setText("");
    setRetakeMode(false);
    if (retake) {
      setS((x) => (x ? { ...x, canRetakeLast: false } : x));
      return;
    }
    setLast(target);
    if (r.done) return complete();
    setQuestion(r.question);
    setS((x) => (x ? { ...x, progress: { ...x.progress, answered: x.progress.answered + (retake ? 0 : 1) }, canRetakeLast: (x.retakesAllowed ?? 0) > 0 && !retake } : x));
    if (r.question) {
      setPrep(s?.prepSeconds ?? 0);
      say(r.question.prompt, r);
    }
  }

  async function sendTurn(blob: Blob | null, typedText?: string) {
    const form = new FormData();
    if (blob) form.append("file", blob, `turn.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
    if (typedText) form.append("text", typedText);
    const r = await run(() => call<{ say: string; done: boolean; transcript: string | null } & Audio>("turn", { form }));
    if (!r) return;
    setText("");
    setTurns((t) => [...t, ...(r.transcript ? [{ role: "candidate", text: r.transcript }] : []), { role: "interviewer", text: r.say }]);
    setInterviewer(r.say);
    say(r.say, r, () => {
      if (r.done) void load();
    });
    if (r.done) setTimeout(load, 500);
  }

  async function start() {
    const r = await run(() => call<({ question: State["currentQuestion"] } | { say: string; done: boolean }) & Audio>("start"));
    if (!r) return;
    await load();
    if ("say" in r) {
      setInterviewer(r.say);
      setTurns((t) => (t.length ? t : [{ role: "interviewer", text: r.say }]));
      say(r.say, r);
    } else if (r.question) {
      setQuestion(r.question);
      setPrep(s?.prepSeconds ?? 0);
      say(r.question.prompt, r);
    }
  }

  async function complete() {
    stopSpeech.current();
    await run(() => call("complete"));
    await load();
  }

  if (err && !s) return <Alert tone="danger" title="Interview unavailable">{err}</Alert>;
  if (!s) return <div className="flex justify-center py-20"><Spinner label="Loading interview" /></div>;

  const header = (
    <div className="mb-6">
      <p className="text-sm text-subtle">{s.organisation}</p>
      <h1 className="text-2xl font-semibold">{s.jobTitle}</h1>
      <div className="mt-2 flex flex-wrap gap-2"><Badge>{s.mode === "REALTIME_CONVERSATIONAL" ? "Conversational voice interview" : "Question-by-question interview"}</Badge><Badge>~{s.durationMinutes} minutes</Badge><Badge>{s.questionCount} questions</Badge>{s.providerMode === "FIXTURE" && <Badge tone="warning">Test environment — not a real AI</Badge>}</div>
    </div>
  );

  if (s.status === "COMPLETED")
    return (<>{header}<Card><CardBody className="py-10 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-success" /><h2 className="mt-3 text-xl font-semibold">Interview submitted</h2><p className="mt-2 text-sm text-subtle">Thank you. Your answers will be reviewed by a person on the hiring team. You&apos;ll be notified about next steps; any feedback they choose to share will appear in your account.</p>{turns.length > 0 && <details className="mx-auto mt-6 max-w-xl text-left"><summary className="cursor-pointer text-sm font-medium">Your transcript</summary><ul className="mt-2 space-y-2 text-sm">{turns.map((t, i) => <li key={i}><strong>{t.role === "interviewer" ? "Interviewer" : "You"}:</strong> {t.text}</li>)}</ul></details>}</CardBody></Card></>);
  if (["EXPIRED", "CANCELLED", "FAILED"].includes(s.status))
    return (<>{header}<Alert tone="warning" title={s.status === "EXPIRED" ? "This interview link has expired" : s.status === "CANCELLED" ? "This interview was cancelled" : "This interview couldn't be completed"}>Please contact {s.organisation} if you think this is a mistake.</Alert></>);
  if (!s.providers.ready)
    return (<>{header}<Alert tone="danger" title="This interview can't run right now">The interview service isn&apos;t available on this platform at the moment ({s.providers.message}). Nothing has been recorded and your invitation remains valid. Please try again later or contact {s.organisation}.</Alert></>);

  // ── Notice & consent ──
  if (s.status === "INVITED") {
    if (alternative) return (<>{header}<Alert tone="info" title="Alternative requested">We&apos;ve let {s.organisation} know you&apos;d prefer an alternative to an AI interview. They&apos;ll contact you. Declining won&apos;t count against your application.</Alert></>);
    return (
      <>{header}
        <Card><CardBody className="space-y-5 p-6">
          <div className="flex gap-3"><ShieldCheck className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" /><div><h2 className="font-semibold">Before you start</h2><p className="text-sm text-subtle">Please read how this interview works and how your information is used.</p></div></div>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>{s.mode === "REALTIME_CONVERSATIONAL" ? "An AI interviewer will ask questions out loud and may ask a short follow-up. You can ask it to repeat or clarify at any time." : "You'll see one question at a time. Each answer has a time limit; you can review a recording before submitting it."}</li>
            <li>Your answers are transcribed and compared against job-related criteria set by {s.organisation}. The AI does not assess your voice, accent, appearance, emotions or personality.</li>
            <li><strong>A person on the hiring team reviews every assessment</strong> and makes all decisions.</li>
            <li>{s.recordAudio ? "Audio recordings are kept only if you allow it below; otherwise only the transcript is kept." : "Audio is not stored — only the transcript."} {s.storeTranscript ? "" : "Transcripts are deleted after assessment."}</li>
            {s.allowTypedAnswers && <li>You can type your answers instead of speaking.</li>}
            <li>If your connection drops, {s.allowResume ? "you can resume where you left off" : "contact the employer"}. The link expires {s.expiresAt ? new Date(s.expiresAt).toLocaleString() : "soon"}.</li>
          </ul>
          {s.instructions && <Alert title={`Instructions from ${s.organisation}`}><p className="whitespace-pre-line">{s.instructions}</p></Alert>}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <Checkbox id="c-ai" checked={consent.aiAssessment} onChange={(e) => setConsent({ ...consent, aiAssessment: e.target.checked })} label="I understand my answers will be processed by AI to support (not replace) human review" />
            <Checkbox id="c-tr" checked={consent.transcript} onChange={(e) => setConsent({ ...consent, transcript: e.target.checked })} label="I agree to my answers being transcribed" />
            {s.recordAudio && <Checkbox id="c-rec" checked={consent.recording} onChange={(e) => setConsent({ ...consent, recording: e.target.checked })} label="Keep audio recordings of my answers for the hiring team (optional)" />}
          </div>
          <Field id="acc" label="Need an accommodation? (optional)" hint={`Shared privately with ${s.organisation}, e.g. extra time or a different format.`}><Textarea rows={2} value={consent.accommodation} onChange={(e) => setConsent({ ...consent, accommodation: e.target.value })} /></Field>
          {err && <Alert tone="danger">{err}</Alert>}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" loading={busy} onClick={async () => { const r = await run(() => call<{ ready: boolean }>("consent", { body: { recording: false, aiAssessment: false, transcript: false, accommodationRequest: consent.accommodation || "Candidate requested an alternative to an AI interview." } })); if (r) setAlternative(true); }}>I&apos;d prefer an alternative to an AI interview</Button>
            <Button loading={busy} disabled={!consent.aiAssessment || !consent.transcript} onClick={async () => { const r = await run(() => call<{ ready: boolean }>("consent", { body: { recording: s.recordAudio && consent.recording, aiAssessment: true, transcript: true, accommodationRequest: consent.accommodation || undefined } })); if (r?.ready) await load(); }}>Continue</Button>
          </div>
        </CardBody></Card>
      </>
    );
  }

  // ── Mic check & start ──
  if (s.status === "READY" || s.status === "INTERRUPTED") {
    return (
      <>{header}
        <Card><CardBody className="space-y-5 p-6">
          {s.status === "INTERRUPTED" && <Alert tone="warning" title="Your interview was interrupted">Your previous answers are saved. Check your microphone and resume when ready.</Alert>}
          <h2 className="font-semibold">Check your microphone</h2>
          {rec.state === "idle" && <Button onClick={() => rec.request()}><Mic className="h-4 w-4" />Allow microphone</Button>}
          {rec.state === "requesting" && <Spinner label="Waiting for microphone permission" />}
          {rec.state === "denied" && <Alert tone="danger" title="Microphone blocked">Allow microphone access in your browser settings and reload the page{s.allowTypedAnswers ? ", or continue with typed answers" : ""}.</Alert>}
          {rec.state === "unsupported" && <Alert tone="warning" title="Recording not supported in this browser">Use a recent version of Chrome, Edge, Firefox or Safari{s.allowTypedAnswers ? ", or continue with typed answers" : ""}.</Alert>}
          {(rec.state === "ready" || rec.state === "recording") && (
            <div className="space-y-3">
              <div className="flex items-center gap-4"><LevelMeter level={rec.level} /><p className="text-sm text-subtle" aria-live="polite">{rec.level > 0.08 ? "We can hear you." : "Say something to test your microphone."}</p></div>
              <div className="flex gap-2">
                {rec.state === "ready" ? <Button variant="secondary" size="sm" onClick={() => { rec.start(); setTimeout(async () => { const b = await rec.stop(); if (b) setMicTest(URL.createObjectURL(b)); }, 3000); }}>Record a 3-second test</Button> : <Badge tone="danger">Recording test…</Badge>}
                {micTest && <audio controls src={micTest} aria-label="Microphone test playback" className="h-8" />}
              </div>
              <Button variant="ghost" size="sm" onClick={() => say("This is how questions will sound.", null)}><Volume2 className="h-4 w-4" />Test speaker</Button>
            </div>
          )}
          {s.allowTypedAnswers && <Checkbox id="typed" checked={typed} onChange={(e) => setTyped(e.target.checked)} label={<span className="inline-flex items-center gap-1"><Keyboard className="h-4 w-4" />I&apos;ll type my answers instead</span>} />}
          {err && <Alert tone="danger">{err}</Alert>}
          <Button size="lg" loading={busy} disabled={!(typed || rec.state === "ready")} onClick={start}>{s.status === "INTERRUPTED" ? "Resume interview" : "Start interview"}</Button>
        </CardBody></Card>
      </>
    );
  }

  // ── In progress ──
  const shown = (retakeMode ? last : question)!;
  const pct = Math.round((s.progress.answered / Math.max(1, s.progress.total)) * 100);
  return (
    <>
      {header}
      {offline && <Alert tone="warning" className="mb-4" title="You're offline"><span className="inline-flex items-center gap-1"><WifiOff className="h-4 w-4" />Your answers so far are saved. Reconnect to continue.</span></Alert>}
      <div className="mb-4"><div className="mb-1 flex justify-between text-xs text-subtle"><span>Progress</span><span>{s.progress.answered} of {s.progress.total}</span></div><div className="h-2 rounded bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Interview progress"><div className="h-2 rounded bg-primary transition-all" style={{ width: `${pct}%` }} /></div></div>
      {err && <Alert tone="danger" className="mb-4">{err}</Alert>}

      {s.mode === "STRUCTURED_AUDIO" ? (
        (retakeMode ? last : question) ? (
          <Card><CardBody className="space-y-5 p-6">
            <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-subtle">{retakeMode ? `Retaking question ${shown.position + 1}` : `Question ${shown.position + 1}`}</p><Button variant="ghost" size="sm" onClick={() => say(shown.prompt, null)} aria-label="Read the question aloud"><Volume2 className="h-4 w-4" />Listen</Button></div>
            <h2 className="text-xl font-semibold leading-snug" aria-live="polite">{shown.prompt}</h2>
            {prep > 0 && <p className="flex items-center gap-2 text-sm text-subtle"><Clock className="h-4 w-4" />Preparation time: {prep}s <Button size="sm" variant="ghost" onClick={() => setPrep(0)}>Skip</Button></p>}
            {typed ? (
              <div className="space-y-2"><Field id="answer" label="Your answer"><Textarea rows={8} disabled={busy} value={text} onChange={(e) => setText(e.target.value)} /></Field><Button loading={busy} disabled={text.trim().length < 2} onClick={() => submitAnswer()}>{retakeMode ? "Replace previous answer" : "Submit answer"}</Button>{retakeMode && <Button variant="ghost" onClick={() => setRetakeMode(false)}>Cancel retake</Button>}</div>
            ) : take ? (
              <div className="space-y-3"><p className="text-sm">Review your answer ({Math.round(take.ms / 1000)}s):</p><audio controls src={take.url} className="w-full" aria-label="Your recorded answer" /><div className="flex gap-2"><Button variant="secondary" onClick={() => setTake(null)}><RotateCcw className="h-4 w-4" />Record again</Button><Button loading={busy} onClick={() => submitAnswer()}>{retakeMode ? "Replace previous answer" : "Submit answer"}</Button></div></div>
            ) : rec.state === "recording" ? (
              <div className="space-y-3"><div className="flex items-center gap-4"><LevelMeter level={rec.level} /><span className="tabular-nums text-sm" aria-live="off">{fmtSecs(rec.elapsed)} / {fmtSecs(shown.answerSeconds * 1000)}</span></div><Button variant="danger" onClick={finishRecording}><Square className="h-4 w-4" />Stop recording</Button></div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="lg" disabled={prep > 0 || speaking || rec.state !== "ready"} onClick={() => { stopSpeech.current(); rec.start(); }}><Mic className="h-4 w-4" />Start answering</Button>
                {rec.state !== "ready" && <Button variant="secondary" onClick={() => rec.request()}>Enable microphone</Button>}
                {s.allowTypedAnswers && <Button variant="ghost" onClick={() => setTyped(true)}><Keyboard className="h-4 w-4" />Type instead</Button>}
              </div>
            )}
            <p className="text-xs text-subtle">You have up to {Math.round(shown.answerSeconds / 60) || 1} min{shown.answerSeconds > 60 ? "s" : ""} per answer. Recording stops automatically when time runs out.</p>
            {s.canRetakeLast && !retakeMode && last && !take && rec.state !== "recording" && <Button variant="link" size="sm" onClick={() => setRetakeMode(true)}>Retake my previous answer ({s.retakesAllowed} allowed per question)</Button>}
          </CardBody></Card>
        ) : (
          <Card><CardBody className="space-y-3 p-6 text-center"><p>All questions answered.</p><Button loading={busy} onClick={complete}>Submit interview</Button></CardBody></Card>
        )
      ) : (
        <Card><CardBody className="space-y-5 p-6">
          <div className="rounded-lg bg-primary-soft/60 p-4"><p className="mb-1 flex items-center gap-2 text-xs font-medium text-primary"><Volume2 className="h-3.5 w-3.5" />Interviewer{speaking ? " (speaking…)" : ""}</p><p className="text-lg leading-relaxed" aria-live="polite">{interviewer ?? turns.filter((t) => t.role === "interviewer").at(-1)?.text ?? "…"}</p></div>
          {s.captions && turns.length > 1 && <details><summary className="cursor-pointer text-sm text-subtle">Conversation so far</summary><ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-sm">{turns.map((t, i) => <li key={i}><strong>{t.role === "interviewer" ? "Interviewer" : "You"}:</strong> {t.text}</li>)}</ul></details>}
          {typed ? (
            <div className="space-y-2"><Field id="turn" label="Your reply"><Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} /></Field><Button loading={busy} disabled={!text.trim()} onClick={() => sendTurn(null, text)}>Send</Button></div>
          ) : rec.state === "recording" ? (
            <div className="space-y-3"><div className="flex items-center gap-4"><LevelMeter level={rec.level} /><span className="text-sm text-subtle">Listening… we&apos;ll send when you pause.</span></div><Button variant="danger" onClick={finishRecording}><Square className="h-4 w-4" />I&apos;m done answering</Button></div>
          ) : busy ? (
            <Spinner label="Interviewer is responding" />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="lg" disabled={speaking || rec.state !== "ready"} onClick={() => { stopSpeech.current(); rec.start({ stopOnSilenceMs: 2500, onSilence: () => void finishRecording() }); }}><Mic className="h-4 w-4" />Answer</Button>
              {rec.state !== "ready" && <Button variant="secondary" onClick={() => rec.request()}>Enable microphone</Button>}
              <Button variant="secondary" onClick={() => sendTurn(null, "Could you repeat the question?")}>Repeat</Button>
              <Button variant="secondary" onClick={() => sendTurn(null, "Could you clarify what you mean?")}>Clarify</Button>
              {s.allowTypedAnswers && <Button variant="ghost" onClick={() => setTyped(true)}><Keyboard className="h-4 w-4" />Type instead</Button>}
            </div>
          )}
        </CardBody></Card>
      )}
      <div className="mt-4 flex items-center justify-between text-xs text-subtle">
        <span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Don&apos;t close this tab — if you do, you can resume from your invitation link.</span>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm("Finish now? Unanswered questions will be left blank.")) void complete(); }}>Finish early</Button>
      </div>
    </>
  );
}
