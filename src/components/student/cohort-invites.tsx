"use client";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/badge";

export function CohortInvites({ items }: { items: { id: string; status: string; cohort: string; university: string; graduationYear: number | null }[] }) {
  const r = useAction((id: string, accept: boolean) => api(`/students/me/cohort-invites/${id}`, { body: { accept } }), { success: "Saved" });
  if (!items.length) return <p className="text-sm text-subtle">No university cohort invitations.</p>;
  return (
    <ul className="space-y-3">{items.map((i) => (
      <li key={i.id} className="rounded-lg border border-border p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><p><span className="font-medium">{i.university}</span> · {i.cohort}</p><StatusBadge status={i.status === "ACTIVE" ? "ACTIVE" : "PENDING"} label={i.status === "ACTIVE" ? "Joined" : "Invited"} /></div>
        <p className="mt-1 text-xs text-subtle">If you join, the placement team can see your name, degree, graduation year and how many applications you have by status. They never see employer assessments, interview recordings or feedback.</p>
        <div className="mt-2 flex gap-2">{i.status === "INVITED" ? <><Button size="sm" onClick={() => r.run(i.id, true)}>Join cohort</Button><Button size="sm" variant="secondary" onClick={() => r.run(i.id, false)}>Decline</Button></> : <Button size="sm" variant="secondary" onClick={() => r.run(i.id, false)}>Leave cohort</Button>}</div>
      </li>
    ))}</ul>
  );
}
