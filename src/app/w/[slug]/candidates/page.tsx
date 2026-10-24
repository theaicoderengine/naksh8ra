import Link from "next/link";
import { requirePageOrg } from "@/server/auth/page";
import { listApplications, applicationListQuery, listStages } from "@/server/services/applications";
import { listJobs } from "@/server/services/jobs";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { EmptyState, PermissionDenied } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { CandidateFilters } from "@/components/workspace/candidate-filters";
import { fmtDate, titleCase } from "@/lib/format";

export default async function Candidates({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("candidates.view_all") && !ctx.can("candidates.view_assigned")) return <PermissionDenied what="candidates" />;
  const q = applicationListQuery.parse(sp);
  const [{ items, total }, jobs, stages] = await Promise.all([listApplications(ctx, q), listJobs(ctx, { page: 1, pageSize: 100 }), listStages(ctx)]);
  const base = `/w/${slug}/candidates`;
  const exportQs = new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k]) => ["jobId", "stageId", "status", "q"].includes(k))), org: slug }).toString();
  return (
    <>
      <PageHeader title="Candidates" description="Applications across your vacancies." actions={ctx.can("candidates.export") ? <a className="inline-flex h-10 items-center rounded border border-border bg-surface px-4 text-sm hover:bg-muted" href={`/api/v1/applications/export?${exportQs}`}>Export CSV</a> : null} />
      <CandidateFilters jobs={jobs.items.map((j) => ({ id: j.id, title: j.title }))} stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
      {items.length === 0 ? <EmptyState title="No candidates found" description="Adjust filters, or add candidates from a vacancy's pipeline." /> : (
        <Table caption="Applications" className="mt-4">
          <thead><tr><Th>Candidate</Th><Th>Vacancy</Th><Th>Stage</Th><Th>Interview</Th><Th>Source</Th><Th>Submitted</Th></tr></thead>
          <tbody>{items.map((a) => (
            <Tr key={a.id}>
              <Td><Link href={`${base}/${a.id}`} className="font-medium hover:underline">{a.candidate.firstName} {a.candidate.lastName}</Link><p className="text-xs text-subtle">{a.candidate.email}</p></Td>
              <Td><Link className="hover:underline" href={`/w/${slug}/jobs/${a.job.id}`}>{a.job.title}</Link></Td>
              <Td>{a.stage?.name ?? "—"} <StatusBadge status={a.status} /></Td>
              <Td>{a.sessions[0] ? <span className="flex gap-1"><StatusBadge status={a.sessions[0].status} />{a.sessions[0].providerMode === "FIXTURE" && <Badge tone="warning">Fixture</Badge>}</span> : <span className="text-subtle">—</span>}</Td>
              <Td className="text-subtle">{titleCase(a.source)}</Td>
              <Td className="text-subtle">{fmtDate(a.submittedAt)}</Td>
            </Tr>))}</tbody>
        </Table>
      )}
      <Pagination page={q.page} pageSize={q.pageSize} total={total} basePath={base} params={sp} />
    </>
  );
}
