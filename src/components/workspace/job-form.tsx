"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useOrg } from "./org-context";
import { Card, CardHeader, CardBody } from "../ui/card";
import { Field, Input, Select, Textarea, Checkbox } from "../ui/form";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { useToast } from "../ui/toast";

export type JobFormValue = {
  title: string; departmentId: string; description: string; responsibilities: string; requiredQualifications: string; requiredSkills: string; preferredSkills: string;
  location: string; country: string; remotePolicy: string; employmentType: string; experienceMin: string; experienceMax: string; salaryMin: string; salaryMax: string; salaryCurrency: string; salaryPeriod: string;
  openings: string; applicationDeadline: string; visibility: string; campusHiring: boolean; eligibleGraduationYears: string; eligibleDegrees: string; eligibleProgrammeIds: string[];
  interviewTemplateId: string; competencyIds: string[]; screeningQuestions: { id: string; question: string; required: boolean }[]; aiDraftUsed: boolean;
};

export const emptyJob: JobFormValue = { title: "", departmentId: "", description: "", responsibilities: "", requiredQualifications: "", requiredSkills: "", preferredSkills: "", location: "", country: "", remotePolicy: "ONSITE", employmentType: "FULL_TIME", experienceMin: "", experienceMax: "", salaryMin: "", salaryMax: "", salaryCurrency: "", salaryPeriod: "YEAR", openings: "1", applicationDeadline: "", visibility: "PUBLIC", campusHiring: false, eligibleGraduationYears: "", eligibleDegrees: "", eligibleProgrammeIds: [], interviewTemplateId: "", competencyIds: [], screeningQuestions: [], aiDraftUsed: false };

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function JobForm({ initial, jobId, departments, templates, competencies, programmes }: { initial: JobFormValue; jobId?: string; departments: { id: string; name: string }[]; templates: { id: string; name: string }[]; competencies: { id: string; name: string }[]; programmes: { id: string; name: string }[] }) {
  const org = useOrg();
  const router = useRouter();
  const { toast } = useToast();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftNotes, setDraftNotes] = useState("");
  const set = <K extends keyof JobFormValue>(k: K, val: JobFormValue[K]) => setV((x) => ({ ...x, [k]: val }));

  async function draft() {
    setDrafting(true);
    setErr(null);
    try {
      const d = await api<{ description: string; responsibilities: string[]; requiredQualifications: string[]; requiredSkills: string[]; preferredSkills: string[]; inclusiveLanguageNotes: string[]; providerMode: string }>("/jobs/draft-description", { org: org.slug, body: { title: v.title, notes: draftNotes, location: v.location, employmentType: v.employmentType } });
      setV((x) => ({ ...x, description: d.description, responsibilities: d.responsibilities.join("\n"), requiredQualifications: d.requiredQualifications.join("\n"), requiredSkills: d.requiredSkills.join(", "), preferredSkills: d.preferredSkills.join(", "), aiDraftUsed: true }));
      toast(`AI draft inserted${d.providerMode === "FIXTURE" ? " (test fixture)" : ""}. Review every section before publishing.${d.inclusiveLanguageNotes.length ? " Notes: " + d.inclusiveLanguageNotes.join(" ") : ""}`, "info");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Draft failed");
    } finally {
      setDrafting(false);
    }
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    setErrors({});
    const body = {
      title: v.title, departmentId: v.departmentId || null, description: v.description, responsibilities: v.responsibilities || null,
      requiredQualifications: lines(v.requiredQualifications), requiredSkills: csv(v.requiredSkills), preferredSkills: csv(v.preferredSkills),
      location: v.location || null, country: v.country || null, remotePolicy: v.remotePolicy, employmentType: v.employmentType,
      experienceMin: num(v.experienceMin), experienceMax: num(v.experienceMax), salaryMin: num(v.salaryMin), salaryMax: num(v.salaryMax), salaryCurrency: v.salaryCurrency || null, salaryPeriod: v.salaryMin || v.salaryMax ? v.salaryPeriod : null,
      openings: Number(v.openings || 1), applicationDeadline: v.applicationDeadline ? new Date(v.applicationDeadline).toISOString() : null, visibility: v.visibility, campusHiring: v.campusHiring,
      eligibleGraduationYears: csv(v.eligibleGraduationYears).map(Number).filter(Boolean), eligibleDegrees: csv(v.eligibleDegrees), eligibleProgrammeIds: v.eligibleProgrammeIds,
      interviewTemplateId: v.interviewTemplateId || null, competencyIds: v.competencyIds, screeningQuestions: v.screeningQuestions.filter((q) => q.question.trim()), aiDraftUsed: v.aiDraftUsed,
    };
    try {
      const r = await api<{ id: string }>(jobId ? `/jobs/${jobId}` : "/jobs", { method: jobId ? "PATCH" : "POST", org: org.slug, body });
      toast(jobId ? "Vacancy updated" : "Vacancy created as draft");
      router.push(`/w/${org.slug}/jobs/${r.id}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        setErr(e.message);
      } else setErr("Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      {err && <Alert tone="danger">{err}</Alert>}
      {v.aiDraftUsed && <Alert tone="warning" title="Contains AI-drafted content">You&apos;ll be asked to confirm a human review before this vacancy can be published.</Alert>}
      <Card>
        <CardHeader title="Role" />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="title" label="Job title" required error={errors.title}><Input value={v.title} onChange={(e) => set("title", e.target.value)} /></Field>
            <Field id="dept" label="Department"><Select value={v.departmentId} onChange={(e) => set("departmentId", e.target.value)}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          </div>
          <div className="rounded-lg border border-dashed border-border p-4">
            <p className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />Draft with AI (optional)</p>
            <p className="mt-1 text-xs text-subtle">Generates a starting draft from the title and your notes. Nothing is published without human review.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input aria-label="Notes for the AI draft" placeholder="Key facts: team, seniority, must-have skills…" value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} />
              <Button variant="secondary" loading={drafting} disabled={v.title.trim().length < 2} onClick={draft}>Generate draft</Button>
            </div>
          </div>
          <Field id="desc" label="Description" required error={errors.description}><Textarea rows={8} value={v.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field id="resp" label="Responsibilities" hint="One per line"><Textarea rows={4} value={v.responsibilities} onChange={(e) => set("responsibilities", e.target.value)} /></Field>
          <Field id="quals" label="Required qualifications" hint="One per line — only genuinely job-related requirements"><Textarea rows={3} value={v.requiredQualifications} onChange={(e) => set("requiredQualifications", e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="rs" label="Required skills" hint="Comma-separated"><Input value={v.requiredSkills} onChange={(e) => set("requiredSkills", e.target.value)} /></Field>
            <Field id="ps" label="Preferred skills" hint="Comma-separated"><Input value={v.preferredSkills} onChange={(e) => set("preferredSkills", e.target.value)} /></Field>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Location, terms & compensation" />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field id="loc" label="Location"><Input value={v.location} onChange={(e) => set("location", e.target.value)} /></Field>
          <Field id="cty" label="Country code"><Input maxLength={2} value={v.country} onChange={(e) => set("country", e.target.value.toUpperCase())} /></Field>
          <Field id="rp" label="Work arrangement"><Select value={v.remotePolicy} onChange={(e) => set("remotePolicy", e.target.value)}><option value="ONSITE">On-site</option><option value="HYBRID">Hybrid</option><option value="REMOTE">Remote</option></Select></Field>
          <Field id="et" label="Employment type"><Select value={v.employmentType} onChange={(e) => set("employmentType", e.target.value)}>{["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "TEMPORARY", "GRADUATE_PROGRAMME"].map((t) => <option key={t} value={t}>{t.replace(/_/g, " ").toLowerCase()}</option>)}</Select></Field>
          <Field id="emin" label="Experience min (yrs)" error={errors.experienceMin}><Input inputMode="numeric" value={v.experienceMin} onChange={(e) => set("experienceMin", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field id="emax" label="Experience max (yrs)"><Input inputMode="numeric" value={v.experienceMax} onChange={(e) => set("experienceMax", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field id="smin" label="Salary min" error={errors.salaryMin}><Input inputMode="numeric" value={v.salaryMin} onChange={(e) => set("salaryMin", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field id="smax" label="Salary max"><Input inputMode="numeric" value={v.salaryMax} onChange={(e) => set("salaryMax", e.target.value.replace(/\D/g, ""))} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field id="scur" label="Currency"><Input maxLength={3} placeholder="GBP" value={v.salaryCurrency} onChange={(e) => set("salaryCurrency", e.target.value.toUpperCase())} /></Field>
            <Field id="sper" label="Per"><Select value={v.salaryPeriod} onChange={(e) => set("salaryPeriod", e.target.value)}><option value="YEAR">Year</option><option value="MONTH">Month</option><option value="HOUR">Hour</option></Select></Field>
          </div>
          <Field id="open" label="Openings"><Input inputMode="numeric" value={v.openings} onChange={(e) => set("openings", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field id="dl" label="Application deadline"><Input type="date" value={v.applicationDeadline} onChange={(e) => set("applicationDeadline", e.target.value)} /></Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Visibility & eligibility" description="Eligibility rules must be job-related (graduation window, degree). Never use protected characteristics." />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="vis" label="Visibility"><Select value={v.visibility} onChange={(e) => set("visibility", e.target.value)}><option value="PUBLIC">Public job board</option><option value="CAMPUS">Campus (signed-in students)</option><option value="INTERNAL">Internal only</option><option value="INVITE_ONLY">Invite only</option></Select></Field>
            <div className="pt-7"><Checkbox id="campus" checked={v.campusHiring} onChange={(e) => set("campusHiring", e.target.checked)} label="Campus / graduate hiring" /></div>
            <Field id="gy" label="Eligible graduation years" hint="Comma-separated, e.g. 2026, 2027"><Input value={v.eligibleGraduationYears} onChange={(e) => set("eligibleGraduationYears", e.target.value)} /></Field>
            <Field id="deg" label="Eligible degrees" hint="Comma-separated keywords, e.g. Computer Science"><Input value={v.eligibleDegrees} onChange={(e) => set("eligibleDegrees", e.target.value)} /></Field>
          </div>
          {programmes.length > 0 && (
            <fieldset><legend className="mb-2 text-sm font-medium">Target placement programmes</legend><div className="flex flex-wrap gap-4">{programmes.map((p) => <Checkbox key={p.id} id={`prog-${p.id}`} label={p.name} checked={v.eligibleProgrammeIds.includes(p.id)} onChange={(e) => set("eligibleProgrammeIds", e.target.checked ? [...v.eligibleProgrammeIds, p.id] : v.eligibleProgrammeIds.filter((x) => x !== p.id))} />)}</div></fieldset>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Assessment" />
        <CardBody className="space-y-4">
          <Field id="tpl" label="Default interview template"><Select value={v.interviewTemplateId} onChange={(e) => set("interviewTemplateId", e.target.value)}><option value="">None</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <fieldset><legend className="mb-2 text-sm font-medium">Competency framework</legend><div className="flex flex-wrap gap-4">{competencies.map((c) => <Checkbox key={c.id} id={`comp-${c.id}`} label={c.name} checked={v.competencyIds.includes(c.id)} onChange={(e) => set("competencyIds", e.target.checked ? [...v.competencyIds, c.id] : v.competencyIds.filter((x) => x !== c.id))} />)}</div></fieldset>
          <div>
            <p className="mb-2 text-sm font-medium">Screening questions</p>
            <div className="space-y-2">
              {v.screeningQuestions.map((q, i) => (
                <div key={q.id} className="flex items-center gap-2">
                  <Input aria-label={`Screening question ${i + 1}`} value={q.question} onChange={(e) => set("screeningQuestions", v.screeningQuestions.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} />
                  <Checkbox id={`req-${q.id}`} label="Required" checked={q.required} onChange={(e) => set("screeningQuestions", v.screeningQuestions.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
                  <Button variant="ghost" size="icon" aria-label="Remove question" onClick={() => set("screeningQuestions", v.screeningQuestions.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => set("screeningQuestions", [...v.screeningQuestions, { id: Math.random().toString(36).slice(2, 10), question: "", required: false }])}><Plus className="h-4 w-4" />Add question</Button>
            </div>
          </div>
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => router.back()}>Cancel</Button><Button type="submit" loading={busy}>{jobId ? "Save changes" : "Create draft"}</Button></div>
    </form>
  );
}
