"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/form";
import { StatusBadge } from "../ui/badge";
import { fmtDateTime } from "@/lib/format";

type Ticket = { id: string; subject: string; body: string; status: string; priority: string; createdAt: string; messages: { id: string; body: string; authorId: string; createdAt: string }[] };

export function Tickets({ tickets, org, me }: { tickets: Ticket[]; org?: string; me: string }) {
  const [v, setV] = useState({ subject: "", body: "", priority: "NORMAL" });
  const [reply, setReply] = useState<Record<string, string>>({});
  const create = useAction(() => api("/support/tickets", { org, body: v }), { success: "Ticket opened — we'll reply by email and here", onSuccess: () => setV({ subject: "", body: "", priority: "NORMAL" }) });
  const send = useAction((id: string) => api(`/support/tickets/${id}`, { body: { body: reply[id] } }), { success: "Reply sent", onSuccess: () => setReply({}) });
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <p className="font-semibold">Open a ticket</p>
        <Field id="sub" label="Subject"><Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
        <Field id="pri" label="Priority"><Select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent — service down</option></Select></Field>
        <Field id="body" label="Describe the issue" hint="Please don't include candidate personal data."><Textarea rows={5} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
        <Button loading={create.pending} disabled={v.subject.length < 3 || v.body.length < 10} onClick={() => create.run()}>Submit</Button>
      </div>
      <div className="space-y-3">
        {tickets.length === 0 && <p className="text-sm text-subtle">No tickets yet.</p>}
        {tickets.map((t) => (
          <details key={t.id} className="rounded-lg border border-border bg-surface p-4">
            <summary className="flex cursor-pointer items-center justify-between gap-2"><span className="font-medium">{t.subject}</span><StatusBadge status={t.status} /></summary>
            <p className="mt-3 whitespace-pre-line text-sm">{t.body}</p>
            <ul className="mt-3 space-y-2">{t.messages.map((m) => <li key={m.id} className={`rounded p-2.5 text-sm ${m.authorId === me ? "bg-muted" : "bg-primary-soft"}`}><p className="whitespace-pre-line">{m.body}</p><p className="mt-1 text-xs text-subtle">{m.authorId === me ? "You" : "Support"} · {fmtDateTime(m.createdAt)}</p></li>)}</ul>
            {t.status !== "CLOSED" && <div className="mt-3 flex gap-2"><Input aria-label="Reply" value={reply[t.id] ?? ""} onChange={(e) => setReply({ [t.id]: e.target.value })} /><Button size="sm" disabled={!reply[t.id]} onClick={() => send.run(t.id)}>Reply</Button></div>}
          </details>
        ))}
      </div>
    </div>
  );
}
