import Link from "next/link";
import { requireVerifiedPage } from "@/server/auth/page";
import { listSavedJobs } from "@/server/services/jobs";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { fmtDate } from "@/lib/format";

export default async function Saved() {
  const s = await requireVerifiedPage();
  const items = await listSavedJobs(s.user.id);
  return (
    <>
      <PageHeader title="Saved opportunities" />
      {items.length === 0 ? <EmptyState title="Nothing saved yet" description="Save vacancies to come back to them later." /> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{items.map((s, i) => <li key={i} className="flex justify-between gap-3 p-4 text-sm">{s.job ? <Link className="font-medium hover:underline" href={`/student/jobs/${s.job.id}`}>{s.job.title} <span className="font-normal text-subtle">· {s.job.organisation.name}</span></Link> : <span className="text-subtle">This vacancy is no longer available</span>}<span className="text-subtle">saved {fmtDate(s.savedAt)}</span></li>)}</ul>
      )}
    </>
  );
}
