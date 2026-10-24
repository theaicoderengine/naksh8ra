"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "../workspace/org-context";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input, Select, Textarea } from "../ui/form";
import { Alert } from "../ui/feedback";

export function NewCohort({ programmes }: { programmes: { id: string; name: string }[] }) {
  const org = useOrg();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: "", programmeId: "", graduationYear: "" });
  const c = useAction(() => api("/universities/cohorts", { org: org.slug, body: { name: v.name, programmeId: v.programmeId || null, graduationYear: v.graduationYear ? Number(v.graduationYear) : null } }), { success: "Cohort created", onSuccess: () => setOpen(false) });
  if (!org.can("university.manage")) return null;
  return (<>
    <Button onClick={() => setOpen(true)}>New cohort</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="New cohort" size="sm" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={c.pending} disabled={v.name.length < 2} onClick={() => c.run()}>Create</Button></>}>
      <div className="space-y-3">
        <Field id="cn" label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Computer Science — Class of 2027" /></Field>
        <Field id="cp" label="Programme"><Select value={v.programmeId} onChange={(e) => setV({ ...v, programmeId: e.target.value })}><option value="">None</option>{programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field id="cg" label="Graduation year"><Input inputMode="numeric" maxLength={4} value={v.graduationYear} onChange={(e) => setV({ ...v, graduationYear: e.target.value.replace(/\D/g, "") })} /></Field>
      </div>
    </Dialog>
  </>);
}

export function ImportStudents({ cohortId }: { cohortId: string }) {
  const org = useOrg();
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<{ invited: number; skipped: number; errors: { line: number; message: string }[] } | null>(null);
  const imp = useAction(() => api<{ invited: number; skipped: number; errors: { line: number; message: string }[] }>(`/universities/cohorts/${cohortId}/import`, { org: org.slug, body: { csv } }), { success: (r) => (r.errors.length ? "Import rejected — fix the errors below" : `${r.invited} invited, ${r.skipped} already invited`), onSuccess: (r) => { setReport(r); if (!r.errors.length) setCsv(""); } });
  if (!org.can("university.import")) return null;
  return (
    <div className="space-y-3">
      <Field id="csv" label="Paste CSV or upload a file" hint="Header row required: email,student_number (student_number optional). Invalid rows abort the whole import."><Textarea rows={6} className="font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"email,student_number\nalex@uni.example,S1234"} /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" className="text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
        <Button loading={imp.pending} disabled={!csv.trim()} onClick={() => imp.run()}>Validate & invite</Button>
      </div>
      {report?.errors.length ? <Alert tone="danger" title={`${report.errors.length} problem(s) found — nothing was imported`}><ul className="list-disc pl-5">{report.errors.slice(0, 20).map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}</ul></Alert> : null}
      <p className="text-xs text-subtle">Students receive an email invitation. Until they accept, you only see their email address and status.</p>
    </div>
  );
}

export function ProgrammeForm({ initial, id }: { initial?: { name: string; description: string; academicYear: string; graduationYears: string; degrees: string }; id?: string }) {
  const org = useOrg();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial ?? { name: "", description: "", academicYear: "", graduationYears: "", degrees: "" });
  const save = useAction(() => api(id ? `/universities/programmes/${id}` : "/universities/programmes", { method: id ? "PATCH" : "POST", org: org.slug, body: { name: v.name, description: v.description || null, academicYear: v.academicYear || null, eligibility: { graduationYears: v.graduationYears.split(",").map((x) => Number(x.trim())).filter(Boolean), degrees: v.degrees.split(",").map((x) => x.trim()).filter(Boolean) }, isActive: true } }), { success: "Programme saved", onSuccess: () => setOpen(false) });
  if (!org.can("university.manage")) return null;
  return (<>
    <Button variant={id ? "secondary" : "primary"} size={id ? "sm" : "md"} onClick={() => setOpen(true)}>{id ? "Edit" : "New programme"}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title={id ? "Edit programme" : "New placement programme"} footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={save.pending} disabled={v.name.length < 2} onClick={() => save.run()}>Save</Button></>}>
      <div className="space-y-3">
        <Field id="pn" label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field id="pd" label="Description"><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="pa" label="Academic year"><Input value={v.academicYear} onChange={(e) => setV({ ...v, academicYear: e.target.value })} placeholder="2026/27" /></Field>
          <Field id="pg" label="Graduation years"><Input value={v.graduationYears} onChange={(e) => setV({ ...v, graduationYears: e.target.value })} placeholder="2027" /></Field>
          <Field id="pdg" label="Degrees"><Input value={v.degrees} onChange={(e) => setV({ ...v, degrees: e.target.value })} placeholder="Comma-separated" /></Field>
        </div>
      </div>
    </Dialog>
  </>);
}

export function InviteEmployer({ programmeId }: { programmeId: string }) {
  const org = useOrg();
  const [slug, setSlug] = useState("");
  const inv = useAction(() => api(`/universities/programmes/${programmeId}/employers`, { org: org.slug, body: { employerSlug: slug } }), { success: "Employer invited", onSuccess: () => setSlug("") });
  if (!org.can("university.manage")) return null;
  return <div className="flex gap-2"><Input aria-label="Employer workspace id" className="h-8 w-56" placeholder="Employer workspace ID (slug)" value={slug} onChange={(e) => setSlug(e.target.value)} /><Button size="sm" variant="secondary" disabled={slug.length < 2} loading={inv.pending} onClick={() => inv.run()}>Invite employer</Button></div>;
}

export function RemoveMember({ id }: { id: string }) {
  const org = useOrg();
  const r = useAction(() => api(`/universities/cohort-members/${id}`, { method: "DELETE", org: org.slug }), { success: "Removed" });
  if (!org.can("university.manage")) return null;
  return <Button size="sm" variant="ghost" onClick={() => r.run()}>Remove</Button>;
}
