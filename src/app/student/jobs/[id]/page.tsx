import { notFound } from "next/navigation";
import Link from "next/link";
import { requireVerifiedPage } from "@/server/auth/page";
import { getPublicJob } from "@/server/services/jobs";
import { listResumes } from "@/server/services/resumes";
import { listMyApplications } from "@/server/services/applications";
import { prisma } from "@/server/db/client";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { JobDetailBody } from "@/components/jobs/job-detail";
import { ApplyPanel, SaveJobButton } from "@/components/student/apply-panel";
import { jobAcceptsApplications } from "@/server/domain/state-machines";
import { Alert } from "@/components/ui/feedback";

export default async function StudentJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireVerifiedPage();
  const job = await getPublicJob(s.user.id, id).catch(() => notFound());
  const [resumes, apps, saved] = await Promise.all([listResumes(s.user.id), listMyApplications(s.user.id), prisma.savedJob.findUnique({ where: { userId_jobId: { userId: s.user.id, jobId: id } } })]);
  const existing = apps.find((a) => a.jobId === id) ?? null;
  const open = jobAcceptsApplications({ status: "PUBLISHED", applicationDeadline: job.applicationDeadline });
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div><Link href="/student/jobs" className="text-sm text-subtle hover:underline">← Opportunities</Link><div className="mt-3"><JobDetailBody job={job} /></div></div>
      <aside className="space-y-4">
        <div className="flex justify-end"><SaveJobButton jobId={id} saved={!!saved} /></div>
        {job.eligibility.reasons.length > 0 && <Alert tone="success" title="Why you're eligible">{job.eligibility.reasons.join(" · ")}</Alert>}
        <Card><CardHeader title="Apply" /><CardBody>
          {open ? <ApplyPanel jobId={id} questions={(job.screeningQuestions as { id: string; question: string; required: boolean }[]) ?? []} resumes={resumes.map((r) => ({ id: r.id, label: r.label, isDefault: r.isDefault }))} eligible={job.eligibility.eligible} unmet={job.eligibility.unmet} existing={existing ? { id: existing.id, status: existing.status } : null} /> : <Alert tone="warning">The application deadline has passed.</Alert>}
        </CardBody></Card>
      </aside>
    </div>
  );
}
