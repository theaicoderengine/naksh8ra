import Link from "next/link";
import { Mic, Briefcase } from "lucide-react";
import { requireVerifiedPage } from "@/server/auth/page";
import { studentDashboard } from "@/server/services/students";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { JobCard } from "@/components/jobs/job-card";
import { CohortInvites } from "@/components/student/cohort-invites";
import { fmtDate, fmtRelative } from "@/lib/format";

export default async function StudentHome() {
  const s = await requireVerifiedPage();
  const d = await studentDashboard(s.user.id);
  const active = d.applications.filter((a) => !["WITHDRAWN", "REJECTED", "HIRED", "DRAFT"].includes(a.status));
  return (
    <>
      <PageHeader title={`Hi ${s.user.firstName ?? "there"}`} description="Your applications, interviews and opportunities in one place." actions={<ButtonLink href="/student/jobs"><Briefcase className="h-4 w-4" />Find opportunities</ButtonLink>} />
      {d.pendingInterviews.length > 0 && (
        <Alert tone="info" className="mb-6" title={`You have ${d.pendingInterviews.length} interview${d.pendingInterviews.length > 1 ? "s" : ""} to complete`}>
          <ul className="mt-1 space-y-1">{d.pendingInterviews.map((i) => <li key={i.invitationId}><Link className="font-medium text-primary hover:underline" href={`/interview/i/${i.invitationId}`}>{i.job?.title ?? "Interview"} at {i.job?.organisation}</Link> — {i.status === "IN_PROGRESS" ? "in progress, resume now" : `due ${fmtDate(i.expiresAt)}`}</li>)}</ul>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Active applications" actions={<Link href="/student/applications" className="text-sm text-primary hover:underline">All applications</Link>} />
            <CardBody className="p-0">
              {active.length === 0 ? <p className="px-5 py-6 text-sm text-subtle">No active applications. <Link className="text-primary hover:underline" href="/student/jobs">Browse opportunities</Link>.</p> : (
                <ul>{active.slice(0, 6).map((a) => <li key={a.id} className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 text-sm last:border-0"><div><Link href={`/student/applications/${a.id}`} className="font-medium hover:underline">{a.job?.title ?? "Vacancy"}</Link><p className="text-xs text-subtle">{a.job?.organisation} · updated {fmtRelative(a.updatedAt)}</p></div><StatusBadge status={a.status} /></li>)}</ul>
              )}
            </CardBody>
          </Card>
          <div>
            <h2 className="mb-3 text-lg font-semibold">Recommended for you</h2>
            {d.recommended.length === 0 ? <p className="text-sm text-subtle">Add skills and career preferences to your profile to get recommendations. We explain why each role is suggested.</p> : <div className="grid gap-3">{d.recommended.map((j) => <JobCard key={j.id} job={j} href={`/student/jobs/${j.id}`} />)}</div>}
          </div>
        </div>
        <div className="space-y-6">
          <Card><CardHeader title="Profile strength" /><CardBody>
            <div className="h-2 rounded bg-muted" role="progressbar" aria-valuenow={d.completion.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion"><div className="h-2 rounded bg-primary" style={{ width: `${d.completion.percent}%` }} /></div>
            <p className="mt-2 text-sm"><strong>{d.completion.percent}%</strong> complete</p>
            {d.completion.missing.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-subtle">{d.completion.missing.slice(0, 4).map((m) => <li key={m}>{m}</li>)}</ul>}
            <ButtonLink href="/student/profile" variant="secondary" size="sm" className="mt-3">Edit profile</ButtonLink>
          </CardBody></Card>
          <Card><CardHeader title="Practice interviews" description="Private coaching — never shared with employers" /><CardBody className="space-y-2">
            {d.practice.slice(0, 3).map((p) => <Link key={p.id} href={`/student/practice/${p.id}`} className="flex justify-between text-sm hover:underline"><span>{p.targetRole}</span><StatusBadge status={p.status} /></Link>)}
            <ButtonLink href="/student/practice/new" size="sm"><Mic className="h-4 w-4" />Start practice</ButtonLink>
          </CardBody></Card>
          {d.saved.length > 0 && <Card><CardHeader title="Saved" /><CardBody className="space-y-1.5">{d.saved.slice(0, 5).map((s) => s.job ? <Link key={s.job.id} href={`/student/jobs/${s.job.id}`} className="block text-sm hover:underline">{s.job.title} <span className="text-subtle">· {s.job.organisation.name}</span></Link> : null)}</CardBody></Card>}
          {d.cohortInvites.length > 0 && <Card><CardHeader title="University cohorts" /><CardBody><CohortInvites items={d.cohortInvites} /></CardBody></Card>}
          <Card><CardHeader title="Recent updates" /><CardBody className="space-y-2">{d.notifications.length === 0 ? <p className="text-sm text-subtle">Nothing new.</p> : d.notifications.map((n) => <div key={n.id} className="text-sm"><p className="font-medium">{n.link ? <Link className="hover:underline" href={n.link}>{n.title}</Link> : n.title}</p><p className="text-xs text-subtle">{n.body} · {fmtRelative(n.createdAt)}</p></div>)}</CardBody></Card>
        </div>
      </div>
    </>
  );
}
