import Link from "next/link";
import { requirePageOrg } from "@/server/auth/page";
import { listInterviews } from "@/server/services/interviews";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { EmptyState, PermissionDenied } from "@/components/ui/feedback";
import { fmtDateTime } from "@/lib/format";

export default async function Interviews({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string }> }) {
  const { slug } = await params;
  const { status } = await searchParams;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("candidates.view_all") && !ctx.can("candidates.view_assigned")) return <PermissionDenied what="interviews" />;
  const items = await listInterviews(ctx, { status });
  const base = `/w/${slug}`;
  const filters = [["", "All"], ["review", "Awaiting review"], ["active", "Pending / in progress"], ["failed", "Failed"]];
  return (
    <>
      <PageHeader title="Interviews" description="AI interview sessions across your vacancies." />
      <div className="mb-4 flex flex-wrap gap-2">{filters.map(([k, l]) => <Link key={k} href={k ? `?status=${k}` : "?"} className={`rounded-full border px-3 py-1 text-sm ${(status ?? "") === k ? "border-primary bg-primary-soft text-primary" : "border-border text-subtle hover:bg-muted"}`}>{l}</Link>)}</div>
      {items.length === 0 ? <EmptyState title="No interviews" description="Send an AI interview from a candidate's application." /> : (
        <Table caption="Interviews">
          <thead><tr><Th>Candidate</Th><Th>Vacancy</Th><Th>Mode</Th><Th>Status</Th><Th>Evidence</Th><Th>Updated</Th></tr></thead>
          <tbody>{items.map((s) => (
            <Tr key={s.id}>
              <Td><Link className="font-medium hover:underline" href={["INVITED", "READY", "IN_PROGRESS", "INTERRUPTED", "CREATED"].includes(s.status) ? `${base}/candidates/${s.application.id}` : `${base}/interviews/${s.id}`}>{s.application.candidate.firstName} {s.application.candidate.lastName}</Link></Td>
              <Td>{s.application.job.title}</Td>
              <Td>{s.mode === "REALTIME_CONVERSATIONAL" ? "Conversational" : "Structured"}</Td>
              <Td><span className="flex gap-1"><StatusBadge status={s.status} />{s.providerMode === "FIXTURE" && <Badge tone="warning">Fixture</Badge>}</span></Td>
              <Td>{s.assessment?.evidenceCoverage != null ? `${Math.round(s.assessment.evidenceCoverage * 100)}%` : "—"}</Td>
              <Td className="text-subtle">{fmtDateTime(s.completedAt ?? s.createdAt)}</Td>
            </Tr>))}</tbody>
        </Table>
      )}
    </>
  );
}
