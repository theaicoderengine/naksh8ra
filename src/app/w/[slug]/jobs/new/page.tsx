import { requirePageOrg } from "@/server/auth/page";
import { jobFormData } from "@/server/services/job-form-data";
import { PageHeader } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/feedback";
import { JobForm, emptyJob } from "@/components/workspace/job-form";

export default async function NewJob({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("jobs.create")) return <PermissionDenied what="vacancy creation" />;
  const data = await jobFormData(ctx);
  return (
    <>
      <PageHeader title="New vacancy" description="Vacancies are created as drafts. Publish when ready." />
      <JobForm initial={emptyJob} {...data} />
    </>
  );
}
