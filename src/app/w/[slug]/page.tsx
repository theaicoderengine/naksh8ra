import Link from "next/link";
import { requirePageOrg } from "@/server/auth/page";
import { hrDashboard, recentActivity } from "@/server/services/analytics";
import { cohortAnalytics } from "@/server/services/universities";
import { PageHeader, Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { BarList } from "@/components/charts/bar-list";
import { EmptyState } from "@/components/ui/feedback";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { fmtDate, fmtRelative } from "@/lib/format";

export default async function Dashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  const base = `/w/${slug}`;

  if (ctx.org.type === "UNIVERSITY") {
    const cohorts = ctx.can("analytics.view") ? await cohortAnalytics(ctx) : [];
    return (
      <>
        <PageHeader title="Placement overview" description="Aggregate progress of consenting students. Employer assessments and recordings are never visible here." actions={ctx.can("university.manage") ? <ButtonLink href={`${base}/cohorts`}>Manage cohorts</ButtonLink> : null} />
        {cohorts.length === 0 ? <EmptyState title="No cohorts yet" description="Create a placement programme and a cohort, then invite students by CSV." action={ctx.can("university.manage") ? <ButtonLink href={`${base}/cohorts`}>Create cohort</ButtonLink> : null} /> : (
          <div className="grid gap-4 md:grid-cols-2">
            {cohorts.map((c) => (
              <Card key={c.cohortId}><CardHeader title={c.name} description={`${c.joined} of ${c.invited} invited students joined`} actions={<ButtonLink size="sm" variant="secondary" href={`${base}/cohorts/${c.cohortId}`}>Open</ButtonLink>} />
                <CardBody className="grid grid-cols-3 gap-3 text-center">
                  {[["Applied", c.studentsApplied], ["Offers", c.studentsWithOffers], ["Hired", c.studentsHired]].map(([l, v]) => <div key={String(l)}><p className="text-xl font-semibold tabular-nums">{String(v)}</p><p className="text-xs text-subtle">{String(l)}</p></div>)}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-subtle">Counts below 5 are shown as “&lt;5” to protect individual privacy.</p>
      </>
    );
  }

  const [d, activity] = await Promise.all([hrDashboard(ctx), recentActivity(ctx, 12)]);
  const rate = d.interviews.completionRate;
  return (
    <>
      <PageHeader
        title={`Welcome${ctx.session.user.firstName ? `, ${ctx.session.user.firstName}` : ""}`}
        description={ctx.can("candidates.view_all") ? "Recruitment overview for your organisation." : "Overview of the vacancies you're assigned to."}
        actions={ctx.can("jobs.create") ? <ButtonLink href={`${base}/jobs/new`}>New vacancy</ButtonLink> : null}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open vacancies" value={d.openJobs} />
        <Stat label="Active applications" value={d.activeApplications} />
        <Stat label="Interview completion (90d)" value={rate == null ? "—" : `${Math.round(rate * 100)}%`} hint={`${d.interviews.completedLast90Days} of ${d.interviews.invitedLast90Days} invitations`} />
        {d.credits ? <Stat label="Interview credits" value={d.credits.available} hint={`${d.credits.reserved} reserved for pending invitations`} tone={d.credits.available < 3 ? "warning" : "default"} /> : <Stat label="Time to hire (median)" value={d.timeToHireDays ? `${d.timeToHireDays.median} d` : "—"} />}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Hiring funnel" description="Applications currently at each stage" />
          <CardBody>
            {d.funnel.every((f) => f.count === 0) ? <EmptyState title="No applications yet" description="Publish a vacancy or add candidates to see your funnel." /> : <BarList label="Applications by stage" rows={d.funnel.map((f) => ({ key: f.stageId, label: f.name, value: f.count }))} />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Awaiting review" description="Processed interviews that need a human reviewer" actions={<Link href={`${base}/interviews?status=review`} className="text-sm text-primary hover:underline">View all</Link>} />
          <CardBody className="p-0">
            {d.pendingReviews.length === 0 ? <p className="px-5 py-6 text-sm text-subtle">Nothing waiting for review.</p> : (
              <ul>
                {d.pendingReviews.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 text-sm last:border-0">
                    <div className="min-w-0"><Link href={`${base}/interviews/${s.id}`} className="font-medium hover:underline">{s.application.candidate.firstName} {s.application.candidate.lastName}</Link><p className="truncate text-xs text-subtle">{s.application.job.title} · completed {fmtRelative(s.completedAt)}</p></div>
                    <div className="flex gap-1.5">{s.providerMode === "FIXTURE" && <Badge tone="warning">Fixture</Badge>}<StatusBadge status={s.status} /></div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming & in-progress interviews" />
          <CardBody className="p-0">
            {d.upcoming.length === 0 ? <p className="px-5 py-6 text-sm text-subtle">No pending interviews.</p> : (
              <ul>{d.upcoming.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 text-sm last:border-0">
                  <div><Link href={`${base}/candidates/${s.application.id}`} className="font-medium hover:underline">{s.application.candidate.firstName} {s.application.candidate.lastName}</Link><p className="text-xs text-subtle">{s.application.job.title} · expires {fmtDate(s.expiresAt)}</p></div>
                  <StatusBadge status={s.status} />
                </li>))}</ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={ctx.can("audit.view") ? "Recent activity" : "My vacancies"} />
          <CardBody className="p-0">
            {ctx.can("audit.view") ? (
              activity.length === 0 ? <p className="px-5 py-6 text-sm text-subtle">No activity yet.</p> : <ul>{activity.map((a) => <li key={a.id} className="flex justify-between gap-3 border-b border-border px-5 py-2.5 text-sm last:border-0"><span><span className="font-medium">{a.actor}</span> <span className="text-subtle">{a.action.replace(/[._]/g, " ")}</span></span><span className="whitespace-nowrap text-xs text-subtle">{fmtRelative(a.createdAt)}</span></li>)}</ul>
            ) : d.myAssignments.length === 0 ? <p className="px-5 py-6 text-sm text-subtle">You haven&apos;t been assigned to any vacancies yet.</p> : (
              <ul>{d.myAssignments.map((a) => <li key={a.job.id} className="flex justify-between border-b border-border px-5 py-3 text-sm last:border-0"><Link href={`${base}/jobs/${a.job.id}`} className="font-medium hover:underline">{a.job.title}</Link><span className="text-subtle">{a.job._count.applications} applicants · {a.role.toLowerCase().replace("_", " ")}</span></li>)}</ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
