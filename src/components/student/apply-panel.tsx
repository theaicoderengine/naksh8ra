"use client";
import { useState } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAction } from "../use-action";
import { Button } from "../ui/button";
import { Field, Select, Textarea, Checkbox } from "../ui/form";
import { Alert } from "../ui/feedback";
import { Dialog } from "../ui/dialog";

type Q = { id: string; question: string; required: boolean };
type Preview = Record<string, unknown> & { name: string; email: string; skills: string[]; education: { institution: string; degree: string; graduationYear: number | null }[]; resume: { label: string } | null };

export function SaveJobButton({ jobId, saved }: { jobId: string; saved: boolean }) {
  const t = useAction(() => api(`/opportunities/${jobId}/save`, { method: saved ? "DELETE" : "POST" }), { success: saved ? "Removed from saved" : "Saved" });
  return <Button variant="secondary" size="sm" loading={t.pending} onClick={() => t.run()} aria-pressed={saved}>{saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}{saved ? "Saved" : "Save"}</Button>;
}

export function ApplyPanel({ jobId, questions, resumes, eligible, unmet, existing }: { jobId: string; questions: Q[]; resumes: { id: string; label: string; isDefault: boolean }[]; eligible: boolean; unmet: string[]; existing: { id: string; status: string } | null }) {
  const [resumeId, setResumeId] = useState(resumes.find((r) => r.isDefault)?.id ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cover, setCover] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (existing && existing.status !== "DRAFT") return <Alert tone="success" title="You've applied">Track progress on <Link className="font-medium text-primary underline" href={`/student/applications/${existing.id}`}>your application</Link>.</Alert>;
  if (done) return <Alert tone="success" title="Application submitted">We&apos;ve emailed you a confirmation. <Link className="font-medium text-primary underline" href={`/student/applications/${done}`}>View application</Link></Alert>;
  if (!eligible) return <Alert tone="warning" title="You don't meet the eligibility criteria">{unmet.join(" · ")}. If your profile is out of date, <Link className="text-primary underline" href="/student/profile">update it</Link>.</Alert>;
  async function submit(draft: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: string }>("/students/me/applications", { body: { jobId, resumeVersionId: resumeId || null, coverLetter: cover || undefined, screeningAnswers: Object.entries(answers).map(([id, answer]) => ({ id, answer })), consentToShare: true, saveAsDraft: draft } });
      if (draft) setErr(null);
      setPreview(null);
      if (!draft) setDone(r.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      {err && <Alert tone="danger">{err}</Alert>}
      <Field id="resume" label="Resume to share" hint={resumes.length === 0 ? "You haven't uploaded a resume — you can still apply with your profile." : undefined}>
        <Select value={resumeId} onChange={(e) => setResumeId(e.target.value)}><option value="">No resume (profile only)</option>{resumes.map((r) => <option key={r.id} value={r.id}>{r.label}{r.isDefault ? " (default)" : ""}</option>)}</Select>
      </Field>
      {questions.map((q) => <Field key={q.id} id={`q-${q.id}`} label={q.question} required={q.required}><Textarea rows={3} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} /></Field>)}
      <Field id="cover" label="Cover note (optional)"><Textarea rows={4} value={cover} onChange={(e) => setCover(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-2">
        <Button loading={busy} onClick={async () => { setErr(null); try { setPreview(await api<Preview>("/students/me/applications/preview", { body: { resumeVersionId: resumeId || null } })); } catch (e) { setErr(e instanceof ApiError ? e.message : "Preview failed"); } }}>Preview & submit</Button>
        <Button variant="secondary" loading={busy} onClick={() => submit(true)}>Save draft</Button>
      </div>
      <Dialog open={!!preview} onClose={() => setPreview(null)} title="Review what the employer will receive" size="lg" footer={<><Button variant="secondary" onClick={() => setPreview(null)}>Back</Button><Button loading={busy} disabled={!consent} onClick={() => submit(false)}>Submit application</Button></>}>
        {preview && (
          <div className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2"><p><span className="text-subtle">Name:</span> {preview.name}</p><p><span className="text-subtle">Email:</span> {preview.email}</p>{preview.location ? <p><span className="text-subtle">Location:</span> {String(preview.location)}</p> : null}{preview.headline ? <p><span className="text-subtle">Headline:</span> {String(preview.headline)}</p> : null}</div>
            {preview.education.length > 0 && <div><p className="font-medium">Education</p>{preview.education.map((e, i) => <p key={i} className="text-subtle">{e.degree}, {e.institution}{e.graduationYear ? ` (${e.graduationYear})` : ""}</p>)}</div>}
            {preview.skills.length > 0 && <p><span className="font-medium">Skills:</span> {preview.skills.join(", ")}</p>}
            <p><span className="font-medium">Resume:</span> {preview.resume?.label ?? "none"}</p>
            {Object.keys(answers).length > 0 && <p><span className="font-medium">Screening answers</span> and your cover note are included.</p>}
            <Alert tone="info">Not shared: accessibility requests, practice interviews, privacy settings, university cohort membership.</Alert>
            <Checkbox id="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} label="I agree to share this information with the employer for this vacancy" description="The employer becomes responsible for its recruitment records. You can withdraw your application later." />
          </div>
        )}
      </Dialog>
    </div>
  );
}
