"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Sparkles, ArrowUp, ArrowDown } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useOrg } from "./org-context";
import { Card, CardHeader, CardBody } from "../ui/card";
import { Field, Input, Select, Textarea, Checkbox } from "../ui/form";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { useToast } from "../ui/toast";
import { ConfirmButton } from "../confirm";

type Q = { prompt: string; guidance: string; competencyId: string; answerSeconds: string };
export type TemplateValue = {
  name: string; description: string; mode: string; language: string; durationMinutes: string; questionCount: string; difficulty: string; questionSelection: string; maxFollowUps: string; answerSeconds: string; prepSeconds: string; retakesAllowed: string;
  recordAudio: boolean; storeTranscript: boolean; showTranscriptToCandidate: boolean; allowResume: boolean; candidateInstructions: string; allowTypedAnswers: boolean; extendedTimeMultiplier: string; captions: boolean; competencyIds: string[]; questions: Q[];
};
export const emptyTemplate: TemplateValue = { name: "", description: "", mode: "STRUCTURED_AUDIO", language: "en", durationMinutes: "20", questionCount: "5", difficulty: "INTERMEDIATE", questionSelection: "FIXED", maxFollowUps: "1", answerSeconds: "120", prepSeconds: "15", retakesAllowed: "0", recordAudio: true, storeTranscript: true, showTranscriptToCandidate: false, allowResume: true, candidateInstructions: "", allowTypedAnswers: true, extendedTimeMultiplier: "1", captions: true, competencyIds: [], questions: [] };

export function TemplateEditor({ initial, templateId, competencies, realtimeAllowed }: { initial: TemplateValue; templateId?: string; competencies: { id: string; name: string }[]; realtimeAllowed: boolean }) {
  const org = useOrg();
  const router = useRouter();
  const { toast } = useToast();
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState(false);
  const set = <K extends keyof TemplateValue>(k: K, val: TemplateValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const setQ = (i: number, patch: Partial<Q>) => set("questions", v.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  async function suggest() {
    setGen(true);
    setErr(null);
    try {
      const missing = Math.max(1, Number(v.questionCount) - v.questions.length);
      const r = await api<{ questions: { prompt: string; guidance: string; competencyId: string }[]; providerMode: string }>("/interview-templates/generate-questions", { org: org.slug, body: { competencyIds: v.competencyIds, count: missing, difficulty: v.difficulty, language: v.language, jobTitle: v.name } });
      set("questions", [...v.questions, ...r.questions.map((q) => ({ prompt: q.prompt, guidance: q.guidance, competencyId: q.competencyId, answerSeconds: "" }))]);
      toast(`Added ${r.questions.length} suggested questions${r.providerMode === "FIXTURE" ? " (test fixture)" : ""} — review and edit before saving.`, "info");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Suggestion failed");
    } finally {
      setGen(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: v.name, description: v.description || null, mode: v.mode, language: v.language, durationMinutes: Number(v.durationMinutes), questionCount: Number(v.questionCount), difficulty: v.difficulty, questionSelection: v.questionSelection, maxFollowUps: Number(v.maxFollowUps), answerSeconds: Number(v.answerSeconds), prepSeconds: Number(v.prepSeconds), retakesAllowed: Number(v.retakesAllowed),
        recordAudio: v.recordAudio, storeTranscript: v.storeTranscript, showTranscriptToCandidate: v.showTranscriptToCandidate, allowResume: v.allowResume, candidateInstructions: v.candidateInstructions || null,
        accessibilityOptions: { allowTypedAnswers: v.allowTypedAnswers, extendedTimeMultiplier: Number(v.extendedTimeMultiplier), captions: v.captions },
        competencyIds: v.competencyIds, questions: v.questions.filter((q) => q.prompt.trim()).map((q) => ({ prompt: q.prompt, guidance: q.guidance || null, competencyId: q.competencyId || null, answerSeconds: q.answerSeconds ? Number(q.answerSeconds) : null })),
      };
      await api(templateId ? `/interview-templates/${templateId}` : "/interview-templates", { method: templateId ? "PUT" : "POST", org: org.slug, body });
      toast("Template saved");
      router.push(`/w/${org.slug}/templates`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.message}${Object.values(e.fieldErrors()).length ? ": " + Object.entries(e.fieldErrors()).map(([k, m]) => `${k} — ${m}`).join("; ") : ""}` : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const fixedShort = v.questionSelection === "FIXED" && v.questions.filter((q) => q.prompt.trim()).length < Number(v.questionCount);
  return (
    <div className="space-y-6">
      {err && <Alert tone="danger">{err}</Alert>}
      {templateId && <Alert tone="info">Saving creates a new template version. Interviews already sent keep the version they were sent with.</Alert>}
      <Card><CardHeader title="Basics" /><CardBody className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Template name" required><Input value={v.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field id="mode" label="Interview mode"><Select value={v.mode} onChange={(e) => set("mode", e.target.value)}><option value="STRUCTURED_AUDIO">Structured — one question at a time</option><option value="REALTIME_CONVERSATIONAL" disabled={!realtimeAllowed}>Real-time conversational{realtimeAllowed ? "" : " (not in your plan)"}</option></Select></Field>
        <Field id="desc" label="Internal description" className="sm:col-span-2"><Input value={v.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field id="lang" label="Language" hint="BCP-47 code, e.g. en, es, fr, hi"><Input value={v.language} onChange={(e) => set("language", e.target.value)} /></Field>
        <Field id="diff" label="Difficulty"><Select value={v.difficulty} onChange={(e) => set("difficulty", e.target.value)}>{["ENTRY", "INTERMEDIATE", "ADVANCED", "EXPERT"].map((d) => <option key={d}>{d}</option>)}</Select></Field>
      </CardBody></Card>
      <Card><CardHeader title="Timing & flow" /><CardBody className="grid gap-4 sm:grid-cols-3">
        <Field id="dur" label="Duration (minutes)"><Input inputMode="numeric" value={v.durationMinutes} onChange={(e) => set("durationMinutes", e.target.value.replace(/\D/g, ""))} /></Field>
        <Field id="qc" label="Number of questions"><Input inputMode="numeric" value={v.questionCount} onChange={(e) => set("questionCount", e.target.value.replace(/\D/g, ""))} /></Field>
        <Field id="sel" label="Question selection" hint="Adaptive generates missing questions at start"><Select value={v.questionSelection} onChange={(e) => set("questionSelection", e.target.value)}><option value="FIXED">Fixed</option><option value="ADAPTIVE">Adaptive</option></Select></Field>
        <Field id="ans" label="Answer time (seconds)"><Input inputMode="numeric" value={v.answerSeconds} onChange={(e) => set("answerSeconds", e.target.value.replace(/\D/g, ""))} /></Field>
        <Field id="prep" label="Preparation time (seconds)"><Input inputMode="numeric" value={v.prepSeconds} onChange={(e) => set("prepSeconds", e.target.value.replace(/\D/g, ""))} /></Field>
        <Field id="ret" label="Retakes per question"><Select value={v.retakesAllowed} onChange={(e) => set("retakesAllowed", e.target.value)}>{["0", "1", "2", "3"].map((n) => <option key={n}>{n}</option>)}</Select></Field>
        {v.mode === "REALTIME_CONVERSATIONAL" && <Field id="fu" label="Max follow-ups per question"><Select value={v.maxFollowUps} onChange={(e) => set("maxFollowUps", e.target.value)}>{["0", "1", "2", "3"].map((n) => <option key={n}>{n}</option>)}</Select></Field>}
        <div className="sm:col-span-3"><Checkbox id="resume" checked={v.allowResume} onChange={(e) => set("allowResume", e.target.checked)} label="Allow candidates to resume after a connection interruption" /></div>
      </CardBody></Card>
      <Card><CardHeader title="Recording, transcripts & accessibility" /><CardBody className="grid gap-4 sm:grid-cols-2">
        <Checkbox id="rec" checked={v.recordAudio} onChange={(e) => set("recordAudio", e.target.checked)} label="Store audio recordings" description="Only if the candidate consents. Otherwise only the transcript is kept." />
        <Checkbox id="tr" checked={v.storeTranscript} onChange={(e) => set("storeTranscript", e.target.checked)} label="Store full transcripts" description="If off, transcripts are deleted after assessment; only evidence excerpts remain." />
        <Checkbox id="showtr" checked={v.showTranscriptToCandidate} onChange={(e) => set("showTranscriptToCandidate", e.target.checked)} label="Let candidates see their transcript after completion" />
        <Checkbox id="typed" checked={v.allowTypedAnswers} onChange={(e) => set("allowTypedAnswers", e.target.checked)} label="Allow typed answers" description="Recommended for accessibility." />
        <Checkbox id="cap" checked={v.captions} onChange={(e) => set("captions", e.target.checked)} label="Show live captions" />
        <Field id="ext" label="Time multiplier (accommodation)"><Select value={v.extendedTimeMultiplier} onChange={(e) => set("extendedTimeMultiplier", e.target.value)}>{["1", "1.25", "1.5", "2"].map((n) => <option key={n} value={n}>×{n}</option>)}</Select></Field>
        <Field id="instr" label="Instructions shown to candidates" className="sm:col-span-2"><Textarea value={v.candidateInstructions} onChange={(e) => set("candidateInstructions", e.target.value)} /></Field>
      </CardBody></Card>
      <Card><CardHeader title="Competencies & questions" description="Ratings are given per selected competency using its current rubric." /><CardBody className="space-y-4">
        <fieldset><legend className="mb-2 text-sm font-medium">Competencies assessed</legend><div className="flex flex-wrap gap-4">{competencies.map((c) => <Checkbox key={c.id} id={`c-${c.id}`} label={c.name} checked={v.competencyIds.includes(c.id)} onChange={(e) => set("competencyIds", e.target.checked ? [...v.competencyIds, c.id] : v.competencyIds.filter((x) => x !== c.id))} />)}</div></fieldset>
        <div className="space-y-3">
          {v.questions.map((q, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between"><p className="text-sm font-medium">Question {i + 1}</p>
                <div className="flex">
                  <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => { const n = [...v.questions]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set("questions", n); }}><ArrowUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === v.questions.length - 1} onClick={() => { const n = [...v.questions]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; set("questions", n); }}><ArrowDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label="Remove question" onClick={() => set("questions", v.questions.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <Textarea aria-label={`Question ${i + 1} text`} className="mt-2" rows={2} value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} />
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_200px_140px]">
                <Input aria-label="Reviewer guidance" placeholder="What a strong answer covers (reviewers only)" value={q.guidance} onChange={(e) => setQ(i, { guidance: e.target.value })} />
                <Select aria-label="Competency" value={q.competencyId} onChange={(e) => setQ(i, { competencyId: e.target.value })}><option value="">No competency</option>{competencies.filter((c) => v.competencyIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                <Input aria-label="Answer seconds override" placeholder="Seconds (opt.)" inputMode="numeric" value={q.answerSeconds} onChange={(e) => setQ(i, { answerSeconds: e.target.value.replace(/\D/g, "") })} />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => set("questions", [...v.questions, { prompt: "", guidance: "", competencyId: v.competencyIds[0] ?? "", answerSeconds: "" }])}><Plus className="h-4 w-4" />Add question</Button>
            <Button variant="secondary" size="sm" loading={gen} disabled={v.competencyIds.length === 0} onClick={suggest}><Sparkles className="h-4 w-4" />Suggest questions with AI</Button>
          </div>
          {fixedShort && <Alert tone="warning">Fixed templates need {v.questionCount} questions before they can be sent to candidates ({v.questions.filter((q) => q.prompt.trim()).length} so far).</Alert>}
        </div>
      </CardBody></Card>
      <div className="flex justify-between">
        {templateId ? <ConfirmButton label="Archive template" title="Archive this template?" description="Archived templates can't be used for new invitations." onConfirm={async () => { await api(`/interview-templates/${templateId}`, { method: "DELETE", org: org.slug }); router.push(`/w/${org.slug}/templates`); router.refresh(); }} /> : <span />}
        <Button loading={busy} onClick={save} disabled={!v.name.trim() || v.competencyIds.length === 0}>Save template</Button>
      </div>
    </div>
  );
}
