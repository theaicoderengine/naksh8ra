import Link from "next/link";
import { requirePageOrg } from "@/server/auth/page";
import { listJobs, jobListQuery } from "@/server/services/jobs";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { EmptyState, PermissionDenied } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { fmtDate, titleCase } from "@/lib/format";

export default async function Jobs({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("jobs.view_all") && !ctx.can("jobs.view_assigned")) return <PermissionDenied what="vacancies" />;
  const q = jobListQuery.parse(sp);
  const { items, total } = await listJobs(ctx, q);
  const base = `/w/${slug}/jobs`;
  const statuses = ["", "DRAFT", "PUBLISHED", "PAUSED", "CLOSED", "ARCHIVED"];
  return (
    <>
      <PageHeader title="Jobs" description={ctx.can("jobs.view_all") ? "All vacancies in your organisation." : "Vacancies you're assigned to."} actions={ctx.can("jobs.create") ? <ButtonLink href={`${base}/new`}>New vacancy</ButtonLink> : null} />
      <div className="mb-4 flex flex-wrap gap-2">
        {statuses.map((s) => <Link key={s} href={s ? `${base}?status=${s}` : base} className={`rounded-full border px-3 py-1 text-sm ${(sp.status ?? "") === s ? "border-primary bg-primary-soft text-primary" : "border-border text-subtle hover:bg-muted"}`}>{s ? titleCase(s) : "Active"}</Link>)}
      </div>
      {items.length === 0 ? <EmptyState title="No vacancies here" description="Create a vacancy to start receiving applications." action={ctx.can("jobs.create") ? <ButtonLink href={`${base}/new`}>New vacancy</ButtonLink> : null} /> : (
        <Table caption="Vacancies">
          <thead><tr><Th>Title</Th><Th>Status</Th><Th>Department</Th><Th>Visibility</Th><Th className="text-right">Applicants</Th><Th>Updated</Th></tr></thead>
          <tbody>
            {items.map((j) => (
              <Tr key={j.id}>
                <Td><Link className="font-medium hover:underline" href={`${base}/${j.id}`}>{j.title}</Link><p className="text-xs text-subtle">{j.location ?? "—"} · {titleCase(j.remotePolicy)}</p></Td>
                <Td><StatusBadge status={j.status} /></Td>
                <Td>{j.department?.name ?? "—"}</Td>
                <Td><Badge>{titleCase(j.visibility)}</Badge>{j.campusHiring && <Badge tone="accent" className="ml-1">Campus</Badge>}</Td>
                <Td className="text-right tabular-nums">{j._count.applications}</Td>
                <Td className="text-subtle">{fmtDate(j.updatedAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={q.page} pageSize={q.pageSize} total={total} basePath={base} params={sp} />
    </>
  );
}
