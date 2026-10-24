"use client";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "./org-context";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/badge";
import { EmptyState } from "../ui/feedback";

type Link = { id: string; status: string; programme: { id: string; name: string; academicYear: string | null; organisation: { name: string } } | null };

export function ProgrammeInvites({ items }: { items: Link[] }) {
  const org = useOrg();
  const r = useAction((id: string, accept: boolean) => api(`/placement-programmes/${id}/respond`, { org: org.slug, body: { accept } }), { success: "Updated" });
  if (!items.length) return <EmptyState title="No campus programmes" description="Universities on the platform can invite you to their placement programmes. Accepted programmes can be targeted when you publish campus vacancies." />;
  return (
    <div className="space-y-3">{items.map((l) => (
      <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
        <div><p className="font-medium">{l.programme?.name}</p><p className="text-subtle">{l.programme?.organisation.name}{l.programme?.academicYear ? ` · ${l.programme.academicYear}` : ""}</p></div>
        <div className="flex items-center gap-2"><StatusBadge status={l.status} />{l.status === "INVITED" && org.can("jobs.publish") && <><Button size="sm" onClick={() => r.run(l.id, true)}>Accept</Button><Button size="sm" variant="secondary" onClick={() => r.run(l.id, false)}>Decline</Button></>}</div>
      </div>
    ))}</div>
  );
}
