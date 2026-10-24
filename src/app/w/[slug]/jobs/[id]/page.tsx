import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageOrg } from "@/server/auth/page";
import { getJob } from "@/server/services/jobs";
import { listApplications, listStages } from "@/server/services/applications";
import { listMembers } from "@/server/services/organisations";
import { jobAnalytics } from "@/server/services/analytics";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/feedback";
import { JobActions } from "@/components/workspace/job-actions";
import { Pipeline } from "@/components/workspace/pipeline";
import { TeamAssign } from "@/components/workspace/team-assign";
import { BarList } from "@/components/charts/bar-list";
import { fmtDate, fmtSalary, titleCase, RATING_LABEL } from "@/lib/format";

export default async function JobPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug, id } = await params;
  const { tab = "pipeline" } = await searchParams;
  const ctx = await requirePageOrg(slug);
  const job = await getJob(ctx, id).catch(() => notFound());
  const base = `/w/${slug}`;
  const header = (
    <PageHeader
      breadcrumb={<Link href={`${base}/jobs`} className="hover:underline">Jobs</Link>}
      title={<span className="flex flex-wrap items-center gap-3">{job.title}<StatusBadge status={job.status} /></span>}
      description={`${job.location ?? "No location"} · ${titleCase(job.remotePolicy)} · ${titleCase(job.employmentType)}${job.publishedAt ? ` · published ${fmtDate(job.publishedAt)}` : ""}`}
      actions={<JobActions jobId={job.id} status={job.status} aiDraftPendingReview={job.aiDraftUsed && !job.aiDraftReviewedById} />}
    />
  );
  const tabs = <Tabs tabs={[{ key: "pipeline", label: "Pipeline", count: job._count.applications }, { key: "details", label: "Details" }, { key: "team", label: "Hiring team", count: job.assignments.length }, ...(ctx.can("analytics.view") ? [{ key: "analytics", label: "Analytics" }] : [])]} />;

  if (tab === "details") {
    return (
      <>{header}{tabs}
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card><CardBody className="space-y-4 text-sm">
            <p className="whitespace-pre-line leading-relaxed">{job.description}</p>
            {job.responsibilities && <div><h3 className="mb-1 font-semibold">Responsibilities</h3><p className="whitespace-pre-line">{job.responsibilities}</p></div>}
            {job.requiredQualifications.length > 0 && <div><h3 className="mb-1 font-semibold">Required qualifications</h3><ul className="list-disc pl-5">{job.requiredQualifications.map((q) => <li key={q}>{q}</li>)}</ul></div>}
            {(job.screeningQuestions as { question: string; required: boolean }[]).length > 0 && <div><h3 className="mb-1 font-semibold">Screening questions</h3><ul className="list-disc pl-5">{(job.screeningQuestions as { id: string; question: string; required: boolean }[]).map((q) => <li key={q.id}>{q.question}{q.required && " (required)"}</li>)}</ul></div>}
          </CardBody></Card>
          <Card><CardBody className="space-y-3 text-sm">
            <div><p className="text-subtle">Department</p><p>{job.department?.name ?? "—"}</p></div>
            <div><p className="text-subtle">Compensation</p><p>{fmtSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod) ?? "Not disclosed"}</p></div>
            <div><p className="text-subtle">Visibility</p><p>{titleCase(job.visibility)}{job.campusHiring ? " · campus hiring" : ""}</p></div>
            <div><p className="text-subtle">Deadline</p><p>{fmtDate(job.applicationDeadline)}</p></div>
            <div><p className="text-subtle">Eligibility</p><p>{[job.eligibleGraduationYears.length ? `Graduating ${job.eligibleGraduationYears.join(", ")}` : null, job.eligibleDegrees.length ? job.eligibleDegrees.join(" / ") : null].filter(Boolean).join(" · ") || "Open"}</p></div>
            <div><p className="text-subtle">Interview template</p><p>{job.interviewTemplate?.name ?? "None"}</p></div>
            <div><p className="text-subtle">Skills</p><div className="mt-1 flex flex-wrap gap-1">{job.requiredSkills.map((s) => <Badge key={s} tone="primary">{s}</Badge>)}{job.preferredSkills.map((s) => <Badge key={s}>{s}</Badge>)}</div></div>
            <div><p className="text-subtle">Competencies</p><p>{job.competencies.map((c) => c.competency.name).join(", ") || "—"}</p></div>
            {job.aiDraftUsed && <Badge tone={job.aiDraftReviewedById ? "success" : "warning"}>{job.aiDraftReviewedById ? "AI draft — human reviewed" : "AI draft — review pending"}</Badge>}
          </CardBody></Card>
        </div>
      </>
    );
  }

  if (tab === "team") {
    const m = ctx.can("members.view") ? await listMembers(ctx) : { members: [] };
    return <>{header}{tabs}<TeamAssign jobId={job.id} members={m.members} initial={job.assignments.map((a) => ({ userId: a.userId, role: a.role }))} /></>;
  }

  if (tab === "analytics") {
    const a = await jobAnalytics(ctx, job.id);
    return (
      <>{header}{tabs}
        {!a ? <Alert>No analytics available.</Alert> : (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card><CardHeader title="Applications by status" /><CardBody><BarList label="Applications by status" rows={a.byStatus.map((s) => ({ key: s.status, label: titleCase(s.status), value: s._count._all }))} /></CardBody></Card>
            <Card><CardHeader title="Applications by source" /><CardBody><BarList label="Applications by source" rows={a.bySource.map((s) => ({ key: s.source, label: titleCase(s.source), value: s._count._all }))} /></CardBody></Card>
            <Card><CardHeader title="Interviews by status" /><CardBody><BarList label="Interviews by status" rows={a.sessions.map((s) => ({ key: s.status, label: titleCase(s.status), value: s._count._all }))} /></CardBody></Card>
            <Card><CardHeader title="Competency ratings" description="Reviewer-adjusted where overridden. Insufficient evidence is shown separately, not as a low rating." /><CardBody className="space-y-5">
              {a.competencyDistribution.length === 0 ? <p className="text-sm text-subtle">No assessments yet.</p> : a.competencyDistribution.map((c) => (
                <div key={c.competency}><p className="mb-2 text-sm font-medium">{c.competency} <span className="font-normal text-subtle">({c.total})</span></p>
                  <BarList label={`${c.competency} ratings`} rows={["INSUFFICIENT_EVIDENCE", "R1", "R2", "R3", "R4", "R5"].map((r) => ({ key: r, label: RATING_LABEL[r], value: c.counts[r] ?? 0 }))} /></div>
              ))}
            </CardBody></Card>
          </div>
        )}
      </>
    );
  }

  const [stages, apps] = await Promise.all([listStages(ctx), listApplications(ctx, { jobId: job.id, page: 1, pageSize: 200 })]);
  return (
    <>{header}{tabs}
      <Pipeline jobId={job.id} stages={stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, isTerminal: s.isTerminal }))} apps={JSON.parse(JSON.stringify(apps.items))} />
    </>
  );
}
