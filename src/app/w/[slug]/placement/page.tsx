import { requirePageOrg } from "@/server/auth/page";
import { listProgrammes, programmeOpportunities } from "@/server/services/universities";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PermissionDenied, EmptyState } from "@/components/ui/feedback";
import { ProgrammeForm, InviteEmployer } from "@/components/university/forms";
import { fmtDate } from "@/lib/format";

export default async function Placement({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  if (ctx.org.type !== "UNIVERSITY" || !ctx.can("university.students.view")) return <PermissionDenied what="placement programmes" />;
  const [programmes, opps] = await Promise.all([listProgrammes(ctx), programmeOpportunities(ctx)]);
  return (
    <>
      <PageHeader title="Placement programmes" description="Programmes, participating employers and the opportunities they target at your students." actions={<ProgrammeForm />} />
      {programmes.length === 0 ? <EmptyState title="No programmes yet" description="Create a programme to organise cohorts and invite employers." /> : (
        <div className="grid gap-4 lg:grid-cols-2">{programmes.map((p) => {
          const e = (p.eligibility ?? {}) as { graduationYears?: number[]; degrees?: string[] };
          return (
            <Card key={p.id}><CardHeader title={p.name} description={[p.academicYear, e.graduationYears?.length ? `graduating ${e.graduationYears.join(", ")}` : null].filter(Boolean).join(" · ")} actions={<ProgrammeForm id={p.id} initial={{ name: p.name, description: p.description ?? "", academicYear: p.academicYear ?? "", graduationYears: (e.graduationYears ?? []).join(", "), degrees: (e.degrees ?? []).join(", ") }} />} />
              <CardBody className="space-y-3 text-sm">
                <p className="text-subtle">{p.cohorts.length} cohort(s) · {p.cohorts.reduce((a, c) => a + c._count.members, 0)} students invited</p>
                <div><p className="mb-1 font-medium">Employers</p>{p.employers.length === 0 ? <p className="text-subtle">None yet.</p> : <ul className="space-y-1">{p.employers.map((x) => <li key={x.id} className="flex items-center justify-between">{x.organisation?.name ?? "Employer"}<StatusBadge status={x.status} /></li>)}</ul>}</div>
                <InviteEmployer programmeId={p.id} />
              </CardBody>
            </Card>
          );
        })}</div>
      )}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Opportunities for your students</h2>
      {opps.length === 0 ? <p className="text-sm text-subtle">No employer vacancies currently target your programmes.</p> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{opps.map((o) => <li key={o.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm"><span><span className="font-medium">{o.title}</span> · {o.organisation.name}</span><span className="text-subtle">{o.programmes.join(", ")}{o.applicationDeadline ? ` · apply by ${fmtDate(o.applicationDeadline)}` : ""}</span></li>)}</ul>
      )}
    </>
  );
}
