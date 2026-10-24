"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "./org-context";
import { Button } from "../ui/button";
import { Select, Textarea, Field } from "../ui/form";
import { Dialog } from "../ui/dialog";
import { StatusBadge, Badge } from "../ui/badge";
import { ConfirmButton } from "../confirm";
import { fmtDateTime, RATING_LABEL } from "@/lib/format";
import { Alert } from "../ui/feedback";

export function StageControl({ appId, stageId, stages, status }: { appId: string; stageId: string | null; stages: { id: string; name: string; kind: string }[]; status: string }) {
  const org = useOrg();
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(false);
  const mv = useAction(() => api(`/applications/${appId}/move`, { org: org.slug, body: { stageId: target, reason: reason || undefined, notifyCandidate: notify } }), { success: "Stage updated", onSuccess: () => { setTarget(""); setReason(""); } });
  if (!org.can("applications.move") || status === "WITHDRAWN") return null;
  const kind = stages.find((s) => s.id === target)?.kind;
  const needsReason = kind === "HIRED" || kind === "REJECTED" || ["HIRED", "REJECTED"].includes(status);
  return (
    <>
      <Select aria-label="Move to stage" className="w-56" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Move to stage…</option>
        {stages.filter((s) => s.id !== stageId && s.kind !== "WITHDRAWN").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <Dialog open={!!target} onClose={() => setTarget("")} title={`Move to “${stages.find((s) => s.id === target)?.name}”`} size="sm" footer={<><Button variant="secondary" onClick={() => setTarget("")}>Cancel</Button><Button loading={mv.pending} disabled={needsReason && reason.trim().length < 3} onClick={() => mv.run()}>Confirm</Button></>}>
        <div className="space-y-3">
          <Field id="mv-reason" label={needsReason ? "Reason (required)" : "Reason (optional)"} hint="Recorded in the audit trail."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify candidate of the new status</label>
        </div>
      </Dialog>
    </>
  );
}

export function InviteInterview({ appId, templates, defaultTemplateId, disabled }: { appId: string; templates: { id: string; name: string; mode: string }[]; defaultTemplateId: string | null; disabled?: boolean }) {
  const org = useOrg();
  const [open, setOpen] = useState(false);
  const [tpl, setTpl] = useState(defaultTemplateId ?? templates[0]?.id ?? "");
  const [days, setDays] = useState("7");
  const inv = useAction(() => api(`/applications/${appId}/interviews`, { org: org.slug, body: { templateId: tpl, expiresInDays: Number(days) } }), { success: "Interview invitation sent — 1 credit reserved", onSuccess: () => setOpen(false) });
  if (!org.can("interviews.invite")) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled || templates.length === 0} title={templates.length === 0 ? "Create an interview template first" : undefined}>Send AI interview</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Send AI interview" description="The candidate receives a personal link by email. One credit is reserved now and released if the interview is cancelled, expires unused, or fails on our side." size="sm"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={inv.pending} disabled={!tpl} onClick={() => inv.run()}>Send invitation</Button></>}>
        <div className="space-y-3">
          <Field id="tpl" label="Template"><Select value={tpl} onChange={(e) => setTpl(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.mode === "REALTIME_CONVERSATIONAL" ? "conversational" : "structured"}</option>)}</Select></Field>
          <Field id="days" label="Link valid for (days)"><Select value={days} onChange={(e) => setDays(e.target.value)}>{["3", "5", "7", "10", "14"].map((d) => <option key={d}>{d}</option>)}</Select></Field>
        </div>
      </Dialog>
    </>
  );
}

export function CancelInterview({ sessionId }: { sessionId: string }) {
  const org = useOrg();
  const c = useAction(() => api(`/interviews/${sessionId}/cancel`, { org: org.slug, method: "POST" }), { success: "Interview cancelled" });
  if (!org.can("interviews.invite")) return null;
  return <ConfirmButton label="Cancel" title="Cancel this interview?" description="The link stops working. If the candidate hasn't answered, the reserved credit is released." onConfirm={() => c.run()} />;
}

export function NoteForm({ appId }: { appId: string }) {
  const org = useOrg();
  const [body, setBody] = useState("");
  const add = useAction(() => api(`/applications/${appId}/notes`, { org: org.slug, body: { body } }), { success: "Note added", onSuccess: () => setBody("") });
  if (!org.can("notes.write")) return null;
  return (
    <div className="space-y-2">
      <Textarea aria-label="Add internal note" placeholder="Internal note — never visible to the candidate" value={body} onChange={(e) => setBody(e.target.value)} />
      <Button size="sm" loading={add.pending} disabled={!body.trim()} onClick={() => add.run()}>Add note</Button>
    </div>
  );
}

export function FeedbackForm({ appId, competencies }: { appId: string; competencies: { id: string; name: string }[] }) {
  const org = useOrg();
  const [rec, setRec] = useState("UNDECIDED");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState<Record<string, { rating: string; note: string }>>({});
  const save = useAction(() => api(`/applications/${appId}/feedback`, { org: org.slug, body: { recommendation: rec, summary, competencyNotes: Object.entries(notes).filter(([, v]) => v.rating).map(([competencyId, v]) => ({ competencyId, rating: v.rating, note: v.note })) } }), { success: "Feedback saved" });
  if (!org.can("feedback.write")) return null;
  return (
    <div className="space-y-3">
      <Field id="rec" label="Recommendation"><Select value={rec} onChange={(e) => setRec(e.target.value)}>{["STRONG_YES", "YES", "UNDECIDED", "NO", "STRONG_NO"].map((r) => <option key={r} value={r}>{r.replace("_", " ").toLowerCase()}</option>)}</Select></Field>
      {competencies.map((c) => (
        <div key={c.id} className="grid gap-2 sm:grid-cols-[180px_1fr]">
          <Select aria-label={`${c.name} rating`} value={notes[c.id]?.rating ?? ""} onChange={(e) => setNotes({ ...notes, [c.id]: { rating: e.target.value, note: notes[c.id]?.note ?? "" } })}><option value="">{c.name}: not rated</option>{Object.entries(RATING_LABEL).map(([k, l]) => <option key={k} value={k}>{c.name}: {l}</option>)}</Select>
          <Textarea aria-label={`${c.name} evidence note`} rows={1} className="min-h-[40px]" placeholder="Job-related evidence for this rating" value={notes[c.id]?.note ?? ""} onChange={(e) => setNotes({ ...notes, [c.id]: { rating: notes[c.id]?.rating ?? "", note: e.target.value } })} />
        </div>
      ))}
      <Field id="sum" label="Summary" hint="Base this on job-related evidence only."><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
      <Button size="sm" loading={save.pending} disabled={summary.trim().length < 10} onClick={() => save.run()}>Submit feedback</Button>
    </div>
  );
}

export function Disclosures({ appId, items }: { appId: string; items: { id: string; body: string; status: string; createdAt: string; approvedAt: string | null }[] }) {
  const org = useOrg();
  const [body, setBody] = useState("");
  const draft = useAction(() => api(`/applications/${appId}/disclosures`, { org: org.slug, body: { body } }), { success: "Draft saved", onSuccess: () => setBody("") });
  const act = useAction((id: string, action: "approve" | "retract") => api(`/disclosures/${id}`, { org: org.slug, body: { action } }), { success: "Updated" });
  return (
    <div className="space-y-3">
      <Alert tone="info">Only <strong>approved</strong> feedback is visible to the candidate. Internal notes, reviewer feedback and AI assessments are never shared.</Alert>
      {items.map((d) => (
        <div key={d.id} className="rounded-lg border border-border p-3 text-sm">
          <div className="mb-1 flex items-center justify-between"><StatusBadge status={d.status} /><span className="text-xs text-subtle">{fmtDateTime(d.approvedAt ?? d.createdAt)}</span></div>
          <p className="whitespace-pre-line">{d.body}</p>
          <div className="mt-2 flex gap-2">
            {d.status === "DRAFT" && org.can("feedback.disclose") && <Button size="sm" loading={act.pending} onClick={() => act.run(d.id, "approve")}>Approve & share</Button>}
            {d.status === "APPROVED" && org.can("feedback.disclose") && <Button size="sm" variant="secondary" loading={act.pending} onClick={() => act.run(d.id, "retract")}>Retract</Button>}
          </div>
        </div>
      ))}
      {org.can("feedback.write") && (
        <div className="space-y-2">
          <Textarea aria-label="Draft feedback for candidate" placeholder="Constructive, job-related feedback the candidate will see once approved" value={body} onChange={(e) => setBody(e.target.value)} />
          <Button size="sm" variant="secondary" loading={draft.pending} disabled={body.trim().length < 10} onClick={() => draft.run()}>Save draft</Button>
        </div>
      )}
    </div>
  );
}

export function SessionRow({ s, base }: { s: { id: string; status: string; mode: string; providerMode: string; createdAt: string; completedAt: string | null; billingOutcome: string | null; assessment: { status: string; evidenceCoverage: number | null; results: { rating: string; humanRating: string | null }[] } | null }; base: string }) {
  const active = ["CREATED", "INVITED", "READY", "IN_PROGRESS", "INTERRUPTED"].includes(s.status);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
      <div>
        <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={s.status} /><Badge>{s.mode === "REALTIME_CONVERSATIONAL" ? "Conversational" : "Structured"}</Badge>{s.providerMode === "FIXTURE" && <Badge tone="warning">Fixture provider</Badge>}{s.billingOutcome && <Badge tone={s.billingOutcome === "CONSUMED" ? "neutral" : "success"}>Credit {s.billingOutcome.toLowerCase()}</Badge>}</div>
        <p className="mt-1 text-xs text-subtle">Invited {fmtDateTime(s.createdAt)}{s.completedAt ? ` · completed ${fmtDateTime(s.completedAt)}` : ""}{s.assessment?.evidenceCoverage != null ? ` · evidence coverage ${Math.round(s.assessment.evidenceCoverage * 100)}%` : ""}</p>
      </div>
      <div className="flex gap-2">{active ? <CancelInterview sessionId={s.id} /> : <Link href={`${base}/interviews/${s.id}`} className="text-sm font-medium text-primary hover:underline">Open review →</Link>}</div>
    </div>
  );
}
