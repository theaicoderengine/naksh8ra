"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { Button } from "../ui/button";
import { Input } from "../ui/form";
import { StatusBadge, Badge } from "../ui/badge";
import { ConfirmButton } from "../confirm";
import { ResumeUpload } from "./resume-upload";
import { useRouter } from "next/navigation";
import { fmtDate } from "@/lib/format";

type Parsed = { name?: string | null; email?: string | null; phone?: string | null; location?: string | null; headline?: string | null; skills?: string[] };
type R = { id: string; label: string; fileId: string; parseStatus: string; parseWarnings: string[]; parsed: Parsed | null; isDefault: boolean; createdAt: string; correctedAt: string | null };

function Row({ r }: { r: R }) {
  const [edit, setEdit] = useState(false);
  const [p, setP] = useState<Parsed>({ name: r.parsed?.name ?? "", email: r.parsed?.email ?? "", phone: r.parsed?.phone ?? "", location: r.parsed?.location ?? "", headline: r.parsed?.headline ?? "", skills: r.parsed?.skills ?? [] });
  const save = useAction(() => api(`/students/me/resumes/${r.id}`, { method: "PATCH", body: { parsed: { ...p, skills: p.skills } } }), { success: "Corrections saved", onSuccess: () => setEdit(false) });
  const def = useAction(() => api(`/students/me/resumes/${r.id}`, { method: "PATCH", body: { isDefault: true } }), { success: "Default resume updated" });
  const del = useAction(() => api(`/students/me/resumes/${r.id}`, { method: "DELETE" }), { success: "Resume deleted" });
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><a href={`/api/v1/files/${r.fileId}`} className="font-medium hover:underline">{r.label}</a> {r.isDefault && <Badge tone="primary">Default</Badge>}<p className="text-xs text-subtle">Uploaded {fmtDate(r.createdAt)}{r.correctedAt ? ` · corrected ${fmtDate(r.correctedAt)}` : ""}</p></div>
        <div className="flex flex-wrap gap-2"><StatusBadge status={r.parseStatus === "PARSED" ? "COMPLETED" : r.parseStatus === "NEEDS_REVIEW" ? "REQUIRES_REVIEW" : r.parseStatus} label={r.parseStatus.replace("_", " ").toLowerCase()} />{!r.isDefault && <Button size="sm" variant="ghost" onClick={() => def.run()}>Make default</Button>}<Button size="sm" variant="secondary" onClick={() => setEdit(!edit)}>{edit ? "Close" : "Review details"}</Button><ConfirmButton label="Delete" title="Delete this resume?" description="Employers you've already applied to keep the copy you shared with them." onConfirm={() => del.run()} /></div>
      </div>
      {r.parseWarnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-warning">{r.parseWarnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {edit && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(["name", "email", "phone", "location", "headline"] as const).map((k) => <Input key={k} aria-label={k} placeholder={k} value={(p[k] as string) ?? ""} onChange={(e) => setP({ ...p, [k]: e.target.value })} />)}
          <Input aria-label="skills" placeholder="Skills (comma-separated)" value={(p.skills ?? []).join(", ")} onChange={(e) => setP({ ...p, skills: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          <div className="sm:col-span-2"><Button size="sm" loading={save.pending} onClick={() => save.run()}>Save corrections</Button></div>
        </div>
      )}
    </li>
  );
}

export function ResumeList({ items }: { items: R[] }) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <ResumeUpload onUploaded={() => router.refresh()} />
      <ul className="space-y-3">{items.map((r) => <Row key={r.id} r={r} />)}</ul>
    </div>
  );
}
