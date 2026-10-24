"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "./org-context";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "../ui/form";
import { Table, Th, Td, Tr } from "../ui/table";
import { StatusBadge } from "../ui/badge";
import { ConfirmButton } from "../confirm";
import { fmtDate } from "@/lib/format";

type Org = { name: string; legalName: string | null; website: string | null; industry: string | null; sizeBand: string | null; country: string | null; timezone: string; defaultLocale: string; description: string | null; brandColor: string | null; billingEmail: string | null; settings: Record<string, unknown> };

export function OrgProfileForm({ initial }: { initial: Org }) {
  const org = useOrg();
  const [v, setV] = useState({ ...initial, legalName: initial.legalName ?? "", website: initial.website ?? "", industry: initial.industry ?? "", country: initial.country ?? "", description: initial.description ?? "", brandColor: initial.brandColor ?? "", billingEmail: initial.billingEmail ?? "" });
  const save = useAction(() => api("/organisations/current", { method: "PATCH", org: org.slug, body: { name: v.name, legalName: v.legalName || null, website: v.website || null, industry: v.industry || null, country: v.country || null, timezone: v.timezone, defaultLocale: v.defaultLocale, description: v.description || null, brandColor: v.brandColor || null, billingEmail: v.billingEmail || null } }), { success: "Organisation updated" });
  const ro = !org.can("org.manage");
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="n" label="Name"><Input disabled={ro} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field id="ln" label="Legal name"><Input disabled={ro} value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} /></Field>
        <Field id="w" label="Website" error={save.fieldErrors.website}><Input disabled={ro} value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} /></Field>
        <Field id="ind" label="Industry"><Input disabled={ro} value={v.industry} onChange={(e) => setV({ ...v, industry: e.target.value })} /></Field>
        <Field id="c" label="Country code"><Input disabled={ro} maxLength={2} value={v.country} onChange={(e) => setV({ ...v, country: e.target.value.toUpperCase() })} /></Field>
        <Field id="tz" label="Time zone"><Input disabled={ro} value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} /></Field>
        <Field id="loc" label="Default language"><Input disabled={ro} value={v.defaultLocale} onChange={(e) => setV({ ...v, defaultLocale: e.target.value })} /></Field>
        <Field id="bc" label="Brand colour" hint="Hex, e.g. #1d4ed8" error={save.fieldErrors.brandColor}><Input disabled={ro} value={v.brandColor} onChange={(e) => setV({ ...v, brandColor: e.target.value })} /></Field>
        <Field id="be" label="Billing email"><Input disabled={ro} type="email" value={v.billingEmail} onChange={(e) => setV({ ...v, billingEmail: e.target.value })} /></Field>
      </div>
      <Field id="d" label="Public description" hint="Shown on your vacancies"><Textarea disabled={ro} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      {!ro && <Button loading={save.pending} onClick={() => save.run()}>Save</Button>}
    </div>
  );
}

export function PreferencesForm({ settings }: { settings: Record<string, unknown> }) {
  const org = useOrg();
  const [v, setV] = useState({ requireMfa: !!settings.requireMfa, defaultInvitationDays: Number(settings.defaultInvitationDays ?? 7), notifyOnApplication: settings.notifyOnApplication !== false, candidateFeedbackDefault: (settings.candidateFeedbackDefault as string) ?? "NONE" });
  const save = useAction(() => api("/organisations/current", { method: "PATCH", org: org.slug, body: { settings: v } }), { success: "Preferences saved" });
  const ro = !org.can("org.manage");
  return (
    <div className="space-y-4">
      <Checkbox id="mfa" disabled={ro} checked={v.requireMfa} onChange={(e) => setV({ ...v, requireMfa: e.target.checked })} label="Require two-factor authentication for all members" description="Members without MFA are redirected to enable it before accessing the workspace." />
      <Checkbox id="notify" disabled={ro} checked={v.notifyOnApplication} onChange={(e) => setV({ ...v, notifyOnApplication: e.target.checked })} label="Notify assigned recruiters about new applications" />
      <Field id="days" label="Default interview link validity (days)"><Input disabled={ro} inputMode="numeric" value={String(v.defaultInvitationDays)} onChange={(e) => setV({ ...v, defaultInvitationDays: Number(e.target.value.replace(/\D/g, "") || 7) })} /></Field>
      <Field id="fb" label="Candidate feedback"><Select disabled={ro} value={v.candidateFeedbackDefault} onChange={(e) => setV({ ...v, candidateFeedbackDefault: e.target.value })}><option value="NONE">Only share feedback we explicitly approve</option><option value="APPROVED_ONLY">Encourage reviewers to draft feedback for approval</option></Select></Field>
      {!ro && <Button loading={save.pending} onClick={() => save.run()}>Save preferences</Button>}
    </div>
  );
}

export function StagesEditor({ stages }: { stages: { id: string; name: string; kind: string; position: number }[] }) {
  const org = useOrg();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("REVIEW");
  const add = useAction(() => api("/stages", { org: org.slug, body: { name, kind } }), { success: "Stage added", onSuccess: () => setName("") });
  const rename = useAction((id: string, n: string) => api(`/stages/${id}`, { method: "PATCH", org: org.slug, body: { name: n } }), { success: "Stage renamed" });
  const del = useAction((id: string) => api(`/stages/${id}`, { method: "DELETE", org: org.slug }), { success: "Stage deleted" });
  // Swap positions with the neighbouring stage.
  const swap = useAction(async (a: { id: string; position: number }, b: { id: string; position: number }) => {
    await api(`/stages/${a.id}`, { method: "PATCH", org: org.slug, body: { position: b.position } });
    await api(`/stages/${b.id}`, { method: "PATCH", org: org.slug, body: { position: a.position } });
  });
  const can = org.can("interviews.configure");
  return (
    <div className="space-y-4">
      <p className="text-sm text-subtle">Each stage maps to a lifecycle type, which drives the candidate-facing status and decision rules (hire/reject always need a reason and decision permission).</p>
      <Table caption="Pipeline stages"><thead><tr><Th>Order</Th><Th>Name</Th><Th>Type</Th><Th /></tr></thead><tbody>
        {stages.map((s, i) => (
          <Tr key={s.id}>
            <Td className="w-28">{can && <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => swap.run(s, stages[i - 1])}>↑</Button><Button size="sm" variant="ghost" aria-label="Move down" disabled={i === stages.length - 1} onClick={() => swap.run(s, stages[i + 1])}>↓</Button></div>}</Td>
            <Td>{can ? <Input aria-label={`Name of stage ${s.name}`} defaultValue={s.name} className="h-8" onBlur={(e) => e.target.value !== s.name && rename.run(s.id, e.target.value)} /> : s.name}</Td>
            <Td><StatusBadge status={s.kind} label={s.kind.replace(/_/g, " ").toLowerCase()} /></Td>
            <Td className="text-right">{can && <ConfirmButton label="Delete" title={`Delete stage “${s.name}”?`} description="Only possible when no applications are in it and another stage of the same type exists." onConfirm={() => del.run(s.id)} />}</Td>
          </Tr>
        ))}
      </tbody></Table>
      {can && <div className="flex flex-wrap gap-2"><Input aria-label="New stage name" className="w-64" placeholder="New stage name" value={name} onChange={(e) => setName(e.target.value)} /><Select aria-label="Stage type" className="w-56" value={kind} onChange={(e) => setKind(e.target.value)}>{["REVIEW", "SCREENING", "AI_INTERVIEW_INVITED", "AI_INTERVIEW_COMPLETED", "HUMAN_INTERVIEW", "FINAL_REVIEW", "OFFER", "REJECTED"].map((k) => <option key={k} value={k}>{k.replace(/_/g, " ").toLowerCase()}</option>)}</Select><Button disabled={name.trim().length < 2} loading={add.pending} onClick={() => add.run()}>Add stage</Button></div>}
    </div>
  );
}

export function DepartmentsEditor({ items }: { items: { id: string; name: string }[] }) {
  const org = useOrg();
  const [name, setName] = useState("");
  const add = useAction(() => api("/departments", { org: org.slug, body: { name } }), { success: "Department added", onSuccess: () => setName("") });
  const del = useAction((id: string) => api(`/departments/${id}`, { method: "DELETE", org: org.slug }), { success: "Department deleted" });
  const can = org.can("departments.manage");
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border">{items.length === 0 && <li className="p-3 text-sm text-subtle">No departments yet.</li>}{items.map((d) => <li key={d.id} className="flex items-center justify-between p-3 text-sm">{d.name}{can && <Button size="sm" variant="ghost" onClick={() => del.run(d.id)}>Delete</Button>}</li>)}</ul>
      {can && <div className="flex gap-2"><Input aria-label="Department name" className="w-64" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering" /><Button disabled={name.trim().length < 2} loading={add.pending} onClick={() => add.run()}>Add</Button></div>}
    </div>
  );
}

export function RetentionEditor({ policies }: { policies: { dataCategory: string; retainDays: number; max: number; min: number }[] }) {
  const org = useOrg();
  const [v, setV] = useState(Object.fromEntries(policies.map((p) => [p.dataCategory, String(p.retainDays)])));
  const save = useAction(() => api("/privacy/retention", { method: "PUT", org: org.slug, body: { policies: Object.entries(v).map(([dataCategory, d]) => ({ dataCategory, retainDays: Number(d) })) } }), { success: "Retention policy saved" });
  const can = org.can("retention.manage");
  return (
    <div className="space-y-4">
      <p className="text-sm text-subtle">Data older than these periods is deleted automatically by a daily job (object storage first, then database rows). Backups age out on the provider&apos;s rolling schedule.</p>
      <div className="grid gap-4 sm:grid-cols-3">{policies.map((p) => <Field key={p.dataCategory} id={`ret-${p.dataCategory}`} label={`${p.dataCategory.toLowerCase()} (days)`} hint={`${p.min}–${p.max}`}><Input disabled={!can} inputMode="numeric" value={v[p.dataCategory]} onChange={(e) => setV({ ...v, [p.dataCategory]: e.target.value.replace(/\D/g, "") })} /></Field>)}</div>
      {can && <Button loading={save.pending} onClick={() => save.run()}>Save retention</Button>}
    </div>
  );
}

export function PrivacyRequests({ items }: { items: { id: string; type: string; status: string; email: string; details: string | null; dueAt: string; createdAt: string }[] }) {
  const org = useOrg();
  const resolve = useAction((id: string, status: "COMPLETED" | "REJECTED", note: string) => api(`/privacy/org-requests/${id}`, { org: org.slug, body: { status, note } }), { success: "Request updated" });
  const erase = useAction((candidateId: string, reason: string) => api(`/privacy/candidates/${candidateId}/erase`, { org: org.slug, body: { reason, confirm: true } }), { success: "Candidate erased" });
  if (items.length === 0) return <p className="text-sm text-subtle">No data subject requests have been addressed to your organisation.</p>;
  return (
    <Table caption="Data subject requests"><thead><tr><Th>Received</Th><Th>Type</Th><Th>Status</Th><Th>Details</Th><Th>Due</Th><Th /></tr></thead><tbody>
      {items.map((r) => {
        const candidateId = r.details?.match(/Candidate record: (\w+)/)?.[1];
        return (
          <Tr key={r.id}>
            <Td className="text-subtle">{fmtDate(r.createdAt)}</Td><Td>{r.type.toLowerCase()}</Td><Td><StatusBadge status={r.status} /></Td><Td className="max-w-sm whitespace-pre-line text-xs text-subtle">{r.details}</Td><Td>{fmtDate(r.dueAt)}</Td>
            <Td className="text-right">{["RECEIVED", "IN_PROGRESS"].includes(r.status) && <div className="flex justify-end gap-2">
              {candidateId && r.type === "DELETION" && <ConfirmButton label="Erase candidate" title="Erase this candidate permanently?" description="Deletes the candidate, applications, interviews, recordings, transcripts, assessments and documents. This cannot be undone." requireReason onConfirm={async (reason) => { await erase.run(candidateId, reason); await resolve.run(r.id, "COMPLETED", `Erased: ${reason}`); }} />}
              <ConfirmButton variant="secondary" label="Mark resolved" title="Resolve request" requireReason confirmLabel="Resolve" onConfirm={(note) => resolve.run(r.id, "COMPLETED", note)} />
            </div>}</Td>
          </Tr>
        );
      })}
    </tbody></Table>
  );
}

export function Accommodations({ items }: { items: { id: string; details: string; status: string; createdAt: string; responseNote: string | null }[] }) {
  const org = useOrg();
  const [note, setNote] = useState<Record<string, string>>({});
  const respond = useAction((id: string, status: string) => api(`/accommodations/${id}`, { org: org.slug, body: { status, note: note[id] } }), { success: "Response recorded" });
  if (items.length === 0) return <p className="text-sm text-subtle">No accommodation requests.</p>;
  return (
    <div className="space-y-3">{items.map((a) => (
      <div key={a.id} className="rounded-lg border border-border p-3 text-sm">
        <div className="flex justify-between"><StatusBadge status={a.status} /><span className="text-xs text-subtle">{fmtDate(a.createdAt)}</span></div>
        <p className="mt-2 whitespace-pre-line">{a.details}</p>
        {a.responseNote && <p className="mt-1 text-xs text-subtle">Response: {a.responseNote}</p>}
        {org.can("candidates.manage") && a.status !== "GRANTED" && a.status !== "DECLINED" && (
          <div className="mt-2 flex flex-wrap gap-2"><Input aria-label="Response note" className="h-8 w-72" placeholder="Note to record (optional)" value={note[a.id] ?? ""} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} />
            <Button size="sm" variant="secondary" onClick={() => respond.run(a.id, "ACKNOWLEDGED")}>Acknowledge</Button><Button size="sm" onClick={() => respond.run(a.id, "GRANTED")}>Grant</Button><Button size="sm" variant="ghost" onClick={() => respond.run(a.id, "DECLINED")}>Decline</Button></div>
        )}
      </div>
    ))}</div>
  );
}

export function SupportAccess({ items }: { items: { id: string; reason: string; status: string; createdAt: string; expiresAt: string | null }[] }) {
  const org = useOrg();
  const decide = useAction((id: string, approve: boolean) => api(`/support-access/${id}`, { org: org.slug, body: { approve } }), { success: "Decision recorded" });
  return (
    <div className="space-y-3">
      <p className="text-sm text-subtle">Platform support can request time-boxed (24h) access to workspace <strong>metadata</strong> to help you. It never includes candidate documents, recordings, transcripts or assessments.</p>
      {items.length === 0 ? <p className="text-sm text-subtle">No support access requests.</p> : items.map((g) => (
        <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
          <div><StatusBadge status={g.status} /> <span className="text-subtle">{fmtDate(g.createdAt)}{g.expiresAt ? ` · expires ${fmtDate(g.expiresAt)}` : ""}</span><p className="mt-1">{g.reason}</p></div>
          {g.status === "REQUESTED" && <div className="flex gap-2"><Button size="sm" onClick={() => decide.run(g.id, true)}>Approve</Button><Button size="sm" variant="secondary" onClick={() => decide.run(g.id, false)}>Deny</Button></div>}
        </div>
      ))}
    </div>
  );
}
