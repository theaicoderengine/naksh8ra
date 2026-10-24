"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "./org-context";
import { Button } from "../ui/button";
import { Select, Field, Input, Textarea, Checkbox } from "../ui/form";
import { Dialog } from "../ui/dialog";
import { StatusBadge, Badge } from "../ui/badge";
import { EmptyState } from "../ui/feedback";
import { fmtRelative } from "@/lib/format";

type Stage = { id: string; name: string; kind: string; isTerminal: boolean };
type App = { id: string; status: string; stageId: string | null; submittedAt: string | null; updatedAt: string; source: string; candidate: { firstName: string; lastName: string; email: string }; sessions: { status: string; providerMode: string; assessment: { status: string; evidenceCoverage: number | null } | null }[] };

/** Board view of a vacancy's applications grouped by stage, with validated single and bulk moves. */
export function Pipeline({ stages, apps, jobId }: { stages: Stage[]; apps: App[]; jobId: string }) {
  const org = useOrg();
  const [selected, setSelected] = useState<string[]>([]);
  const [move, setMove] = useState<{ ids: string[]; stageId: string } | null>(null);
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [cand, setCand] = useState({ firstName: "", lastName: "", email: "" });
  const doMove = useAction(
    (ids: string[], stageId: string) =>
      ids.length === 1 ? api(`/applications/${ids[0]}/move`, { org: org.slug, body: { stageId, reason: reason || undefined, notifyCandidate: notify } }) : api<{ results: { ok: boolean; error?: string }[] }>("/applications/bulk-move", { org: org.slug, body: { applicationIds: ids, stageId, reason: reason || undefined, notifyCandidate: notify } }),
    {
      success: (r) => {
        const res = (r as { results?: { ok: boolean; error?: string }[] })?.results;
        if (!res) return "Moved";
        const failed = res.filter((x) => !x.ok);
        return failed.length ? `${res.length - failed.length} moved, ${failed.length} skipped: ${failed[0].error}` : `${res.length} moved`;
      },
      onSuccess: () => { setMove(null); setSelected([]); setReason(""); setNotify(false); },
    },
  );
  const add = useAction(() => api("/candidates", { org: org.slug, body: { jobId, ...cand, source: "DIRECT" } }), { success: "Candidate added", onSuccess: () => { setAddOpen(false); setCand({ firstName: "", lastName: "", email: "" }); } });
  const target = move ? stages.find((s) => s.id === move.stageId) : null;
  const needsReason = !!target && ["HIRED", "REJECTED"].includes(target.kind);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-subtle">{apps.length} applications{selected.length ? ` · ${selected.length} selected` : ""}</p>
        <div className="flex flex-wrap gap-2">
          {selected.length > 0 && org.can("applications.move") && (
            <Select aria-label="Move selected to stage" className="w-56" value="" onChange={(e) => e.target.value && setMove({ ids: selected, stageId: e.target.value })}>
              <option value="">Move selected to…</option>
              {stages.filter((s) => s.kind !== "WITHDRAWN").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
          {org.can("candidates.manage") && <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>Add candidate</Button>}
          {org.can("candidates.export") && <a className="inline-flex h-8 items-center rounded border border-border px-3 text-sm hover:bg-muted" href={`/api/v1/applications/export?jobId=${jobId}&org=${org.slug}`}>Export CSV</a>}
        </div>
      </div>
      {apps.length === 0 ? <EmptyState title="No applications yet" description="Applications appear here when candidates apply or you add them." /> : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {stages.map((s) => {
            const col = apps.filter((a) => a.stageId === s.id);
            return (
              <section key={s.id} aria-label={s.name} className="w-64 shrink-0 rounded-lg border border-border bg-muted/40">
                <header className="flex items-center justify-between border-b border-border px-3 py-2"><h3 className="text-sm font-semibold">{s.name}</h3><span className="text-xs text-subtle">{col.length}</span></header>
                <ul className="space-y-2 p-2">
                  {col.map((a) => {
                    const sess = a.sessions[0];
                    return (
                      <li key={a.id} className="rounded-md border border-border bg-surface p-2.5 text-sm shadow-card">
                        <div className="flex items-start gap-2">
                          {org.can("applications.move") && <input type="checkbox" aria-label={`Select ${a.candidate.firstName} ${a.candidate.lastName}`} className="mt-1" checked={selected.includes(a.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, a.id] : selected.filter((x) => x !== a.id))} />}
                          <div className="min-w-0 flex-1">
                            <Link href={`/w/${org.slug}/candidates/${a.id}`} className="font-medium hover:underline">{a.candidate.firstName} {a.candidate.lastName}</Link>
                            <p className="truncate text-xs text-subtle">{a.source === "STUDENT_PORTAL" ? "Student portal · " : ""}{fmtRelative(a.updatedAt)}</p>
                            {sess && <div className="mt-1.5 flex flex-wrap gap-1"><StatusBadge status={sess.status} />{sess.providerMode === "FIXTURE" && <Badge tone="warning">Fixture</Badge>}{sess.assessment?.evidenceCoverage != null && <Badge>{Math.round(sess.assessment.evidenceCoverage * 100)}% evidence</Badge>}</div>}
                          </div>
                        </div>
                        {org.can("applications.move") && !["WITHDRAWN"].includes(a.status) && (
                          <Select aria-label="Move to stage" className="mt-2 h-8 text-xs" value="" onChange={(e) => e.target.value && setMove({ ids: [a.id], stageId: e.target.value })}>
                            <option value="">Move to…</option>
                            {stages.filter((x) => x.id !== s.id && x.kind !== "WITHDRAWN").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </Select>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <Dialog open={!!move} onClose={() => setMove(null)} title={`Move ${move?.ids.length ?? 0} application(s) to “${target?.name ?? ""}”`} size="sm"
        footer={<><Button variant="secondary" onClick={() => setMove(null)}>Cancel</Button><Button loading={doMove.pending} disabled={needsReason && reason.trim().length < 3} onClick={() => move && doMove.run(move.ids, move.stageId)}>Move</Button></>}>
        <div className="space-y-4">
          <Field id="reason" label={needsReason ? "Reason for decision (required)" : "Reason (optional)"} hint="Recorded in the audit trail; not shared with the candidate."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Checkbox id="notify" checked={notify} onChange={(e) => setNotify(e.target.checked)} label="Notify the candidate of the status change" description="They see a simplified status (e.g. “In review”, “Not progressing”), never internal notes." />
        </div>
      </Dialog>
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add candidate" size="sm" footer={<><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button loading={add.pending} onClick={() => add.run()}>Add</Button></>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Field id="cf" label="First name"><Input value={cand.firstName} onChange={(e) => setCand({ ...cand, firstName: e.target.value })} /></Field><Field id="cl" label="Last name"><Input value={cand.lastName} onChange={(e) => setCand({ ...cand, lastName: e.target.value })} /></Field></div>
          <Field id="ce" label="Email" error={add.fieldErrors.email}><Input type="email" value={cand.email} onChange={(e) => setCand({ ...cand, email: e.target.value })} /></Field>
        </div>
      </Dialog>
    </div>
  );
}
