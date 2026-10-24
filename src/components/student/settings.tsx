"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { Button } from "../ui/button";
import { Textarea, Field, Checkbox } from "../ui/form";
import { StatusBadge } from "../ui/badge";
import { ConfirmButton } from "../confirm";
import { Alert } from "../ui/feedback";
import { fmtDate } from "@/lib/format";

const TOPICS: Record<string, string> = { interview_reminders: "Interview reminders", application_updates: "Application updates", opportunity_alerts: "New matching opportunities", product: "Product news" };

export function NotificationPrefs({ prefs }: { prefs: { channel: string; topic: string; enabled: boolean }[] }) {
  const [v, setV] = useState(prefs);
  const save = useAction(() => api("/students/me/notification-preferences", { method: "PUT", body: { prefs: v } }), { success: "Preferences saved" });
  return (
    <div className="space-y-3">
      <table className="w-full text-sm"><thead><tr className="text-left text-subtle"><th className="py-1 font-medium">Topic</th><th className="font-medium">Email</th><th className="font-medium">In-app</th></tr></thead><tbody>
        {Object.entries(TOPICS).map(([t, label]) => <tr key={t} className="border-t border-border"><td className="py-2">{label}</td>{["EMAIL", "IN_APP"].map((ch) => { const p = v.find((x) => x.channel === ch && x.topic === t)!; return <td key={ch}><input type="checkbox" aria-label={`${label} by ${ch}`} checked={p?.enabled ?? false} onChange={(e) => setV(v.map((x) => (x.channel === ch && x.topic === t ? { ...x, enabled: e.target.checked } : x)))} /></td>; })}</tr>)}
      </tbody></table>
      <p className="text-xs text-subtle">Security and account emails (verification, password changes) are always sent.</p>
      <Button size="sm" loading={save.pending} onClick={() => save.run()}>Save</Button>
    </div>
  );
}

export function PrivacyControls({ requests }: { requests: { id: string; type: string; status: string; createdAt: string; resultFileId: string | null }[] }) {
  const req = useAction((type: "EXPORT" | "DELETION", details?: string) => api("/privacy/requests", { body: { type, details } }), { success: (r) => ((r as { type: string }).type === "DELETION" ? "Deletion processed" : "Export requested — we'll email you when it's ready") });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={req.pending} onClick={() => req.run("EXPORT")}>Download my data</Button>
        <ConfirmButton label="Delete my account" title="Permanently delete your account?" description="Your profile, resumes, practice sessions and settings are deleted and you are signed out. Employers you applied to are notified to delete their records. This cannot be undone." requireReason confirmLabel="Delete account" onConfirm={async (reason) => { await req.run("DELETION", reason); window.location.href = "/"; }} />
      </div>
      {requests.length > 0 && <ul className="space-y-1 text-sm">{requests.map((r) => <li key={r.id} className="flex items-center gap-2">{r.type.toLowerCase()} · {fmtDate(r.createdAt)} <StatusBadge status={r.status} />{r.resultFileId && <a className="text-primary hover:underline" href={`/api/v1/files/${r.resultFileId}`}>Download</a>}</li>)}</ul>}
    </div>
  );
}

export function AccommodationForm({ items }: { items: { id: string; details: string; status: string; responseNote: string | null; createdAt: string }[] }) {
  const [details, setDetails] = useState("");
  const [general, setGeneral] = useState(true);
  const send = useAction(() => api("/students/me/accommodations", { body: { details } }), { success: "Request recorded", onSuccess: () => setDetails("") });
  return (
    <div className="space-y-3">
      <Alert tone="info">Accommodation requests are private. To share one with a specific employer, use the option on that interview&apos;s start screen — they&apos;ll only see what you write.</Alert>
      <Field id="acc" label="Describe the support you need" hint="e.g. extra time, typed answers instead of speaking, screen reader compatibility"><Textarea value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
      <Checkbox id="gen" checked={general} onChange={(e) => setGeneral(e.target.checked)} label="Keep this as a general note for my own records" />
      <Button size="sm" loading={send.pending} disabled={details.trim().length < 10} onClick={() => send.run()}>Save request</Button>
      {items.map((a) => <div key={a.id} className="rounded border border-border p-2.5 text-sm"><StatusBadge status={a.status} /> <span className="text-xs text-subtle">{fmtDate(a.createdAt)}</span><p className="mt-1">{a.details}</p>{a.responseNote && <p className="text-xs text-subtle">Response: {a.responseNote}</p>}</div>)}
    </div>
  );
}
