"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Keyboard, Volume2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAction } from "../use-action";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/form";
import { Alert } from "../ui/feedback";
import { Card, CardBody } from "../ui/card";
import { Badge } from "../ui/badge";
import { useRecorder, speak } from "../interview/use-recorder";

export function NewPracticeForm() {
  const router = useRouter();
  const [v, setV] = useState({ targetRole: "", focus: "GENERAL", language: "en", questionCount: "4", durationMinutes: "10" });
  const start = useAction(() => api<{ id: string }>("/students/me/practice", { body: { ...v, mode: "STRUCTURED_AUDIO", questionCount: Number(v.questionCount), durationMinutes: Number(v.durationMinutes) } }), { refresh: false, onSuccess: (r) => router.push(`/student/practice/${r.id}`) });
  return (
    <div className="space-y-4">
      {start.error && <Alert tone="danger">{start.error.message}</Alert>}
      <Field id="role" label="Target role"><Input value={v.targetRole} onChange={(e) => setV({ ...v, targetRole: e.target.value })} placeholder="e.g. Graduate software engineer" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="focus" label="Type of practice"><Select value={v.focus} onChange={(e) => setV({ ...v, focus: e.target.value })}><option value="GENERAL">General / behavioural</option><option value="ROLE_SPECIFIC">Role-specific</option></Select></Field>
        <Field id="lang" label="Language"><Select value={v.language} onChange={(e) => setV({ ...v, language: e.target.value })}>{[["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["hi", "Hindi"], ["pt", "Portuguese"], ["ar", "Arabic"], ["zh", "Chinese"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field id="qc" label="Questions"><Select value={v.questionCount} onChange={(e) => setV({ ...v, questionCount: e.target.value })}>{["2", "3", "4", "5", "6", "8"].map((n) => <option key={n}>{n}</option>)}</Select></Field>
        <Field id="dur" label="Duration"><Select value={v.durationMinutes} onChange={(e) => setV({ ...v, durationMinutes: e.target.value })}>{["5", "10", "15", "20", "30"].map((n) => <option key={n} value={n}>{n} minutes</option>)}</Select></Field>
      </div>
      <Button loading={start.pending} disabled={v.targetRole.trim().length < 2} onClick={() => start.run()}>Start practice</Button>
    </div>
  );
}

type Practice = { id: string; status: string; targetRole: string; language: string; providerMode: string; questions: string[]; currentQuestion: string | null; currentIndex: number; answers: { position: number; question: string; transcript: string }[]; feedback: { summary: string; strengths: string[]; improvements: string[]; perQuestion: { position: number; relevance: string; clarity: string; completeness: string; suggestions: string[]; exampleStructure: string }[] } | null };

export function PracticeRoom({ p }: { p: Practice }) {
  const router = useRouter();
  const rec = useRecorder();
  const [typed, setTyped] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState({ q: p.currentQuestion, index: p.currentIndex });
  async function submit(blob: Blob | null) {
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      if (blob) form.append("file", blob, "answer.webm");
      else form.append("text", text);
      const r = await api<{ done: boolean; nextQuestion: string | null }>(`/students/me/practice/${p.id}/answer`, { form });
      setText("");
      if (r.done) {
        await api(`/students/me/practice/${p.id}/complete`, { method: "POST" });
        router.refresh();
      } else setCurrent((c) => ({ q: r.nextQuestion, index: c.index + 1 }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  const tone = (x: string) => (x === "HIGH" ? "success" : x === "MEDIUM" ? "primary" : "warning");
  if (p.status !== "IN_PROGRESS") {
    return (
      <div className="space-y-4">
        {p.status === "COMPLETED" && !p.feedback && <Alert title="Preparing your feedback">Refresh in a moment.</Alert>}
        {p.status === "FAILED" && <Alert tone="danger" title="We couldn't generate feedback">Your practice credit was returned. Please try another session.</Alert>}
        {p.feedback && (
          <>
            <Card><CardBody className="space-y-3 p-6"><h2 className="font-semibold">Coaching summary</h2><p className="text-sm">{p.feedback.summary}</p>
              <div className="grid gap-4 sm:grid-cols-2"><div><p className="text-sm font-medium text-success">Strengths</p><ul className="list-disc pl-5 text-sm">{p.feedback.strengths.map((x) => <li key={x}>{x}</li>)}</ul></div><div><p className="text-sm font-medium text-warning">Try next time</p><ul className="list-disc pl-5 text-sm">{p.feedback.improvements.map((x) => <li key={x}>{x}</li>)}</ul></div></div>
            </CardBody></Card>
            {p.answers.map((a) => {
              const f = p.feedback!.perQuestion.find((x) => x.position === a.position);
              return (
                <Card key={a.position}><CardBody className="space-y-2 p-5 text-sm">
                  <p className="font-medium">Q{a.position + 1}. {a.question}</p>
                  <p className="rounded bg-muted/60 p-3 text-subtle">{a.transcript}</p>
                  {f && <><div className="flex flex-wrap gap-1.5"><Badge tone={tone(f.relevance)}>Relevance: {f.relevance.toLowerCase()}</Badge><Badge tone={tone(f.clarity)}>Clarity: {f.clarity.toLowerCase()}</Badge><Badge tone={tone(f.completeness)}>Completeness: {f.completeness.toLowerCase()}</Badge></div>
                    <ul className="list-disc pl-5">{f.suggestions.map((x) => <li key={x}>{x}</li>)}</ul><p className="text-xs text-subtle"><strong>Example structure:</strong> {f.exampleStructure}</p></>}
                </CardBody></Card>
              );
            })}
          </>
        )}
      </div>
    );
  }
  const q = current.q;
  return (
    <Card><CardBody className="space-y-5 p-6">
      {p.providerMode === "FIXTURE" && <Badge tone="warning">Test environment — not a real AI</Badge>}
      <div className="flex justify-between text-sm text-subtle"><span>Question {current.index + 1} of {p.questions.length}</span><Button variant="ghost" size="sm" onClick={() => q && speak(q, null, p.language)}><Volume2 className="h-4 w-4" />Listen</Button></div>
      <h2 className="text-xl font-semibold">{q}</h2>
      {err && <Alert tone="danger">{err}</Alert>}
      {typed ? (
        <div className="space-y-2"><Textarea aria-label="Your answer" rows={6} disabled={busy} value={text} onChange={(e) => setText(e.target.value)} /><Button loading={busy} disabled={!text.trim()} onClick={() => submit(null)}>Submit answer</Button></div>
      ) : rec.state === "recording" ? (
        <Button variant="danger" loading={busy} onClick={async () => submit(await rec.stop())}><Square className="h-4 w-4" />Stop & submit ({Math.round(rec.elapsed / 1000)}s)</Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          {rec.state === "ready" ? <Button onClick={() => rec.start()}><Mic className="h-4 w-4" />Record answer</Button> : <Button onClick={() => rec.request()}><Mic className="h-4 w-4" />Enable microphone</Button>}
          <Button variant="ghost" onClick={() => setTyped(true)}><Keyboard className="h-4 w-4" />Type instead</Button>
        </div>
      )}
      {rec.state === "denied" && <Alert tone="warning">Microphone access was blocked — you can type your answers instead.</Alert>}
      <p className="text-xs text-subtle">Practice audio is transcribed and immediately discarded. This session is private to you.</p>
    </CardBody></Card>
  );
}

export function BuyPracticeCredits({ packs }: { packs: { key: string; name: string }[] }) {
  const buy = useAction((packKey: string) => api<{ url: string }>("/billing/practice-checkout", { body: { packKey } }), { refresh: false, onSuccess: (r) => { window.location.href = r.url; } });
  if (!packs.length) return null;
  return <div className="flex flex-wrap gap-2">{packs.map((p) => <Button key={p.key} variant="secondary" size="sm" loading={buy.pending} onClick={() => buy.run(p.key)}>Buy {p.name}</Button>)}</div>;
}
