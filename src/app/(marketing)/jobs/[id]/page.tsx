import { notFound } from "next/navigation";
import { Section } from "@/components/marketing";
import { JobDetailBody } from "@/components/jobs/job-detail";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { getPublicJob } from "@/server/services/jobs";
import { currentSession } from "@/server/auth/session";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export default async function PublicJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  const job = await getPublicJob(session?.user.id ?? null, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <Section>
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <JobDetailBody job={job} />
        <aside>
          <Card className="sticky top-24"><CardBody className="space-y-3">
            <p className="font-semibold">Interested?</p>
            <p className="text-sm text-subtle">Apply with your profile. You&apos;ll preview exactly what the employer receives before submitting.</p>
            {session ? <ButtonLink href={`/student/jobs/${job.id}`} className="w-full">Apply</ButtonLink> : <>
              <ButtonLink href={`/register/student?next=/student/jobs/${job.id}`} className="w-full">Create profile & apply</ButtonLink>
              <ButtonLink href={`/login?next=/student/jobs/${job.id}`} variant="secondary" className="w-full">Sign in</ButtonLink>
            </>}
          </CardBody></Card>
        </aside>
      </div>
    </Section>
  );
}
