import { requirePageOrg } from "@/server/auth/page";
import { jobFormData } from "@/server/services/job-form-data";
import { getJob } from "@/server/services/jobs";
import { PageHeader } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/feedback";
import { JobForm, type JobFormValue } from "@/components/workspace/job-form";
import { notFound } from "next/navigation";

export default async function EditJob({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("jobs.edit")) return <PermissionDenied what="vacancy editing" />;
  const job = await getJob(ctx, id).catch(() => notFound());
  const data = await jobFormData(ctx);
  const s = (n: number | null) => (n == null ? "" : String(n));
  const initial: JobFormValue = {
    title: job.title, departmentId: job.departmentId ?? "", description: job.description, responsibilities: job.responsibilities ?? "", requiredQualifications: job.requiredQualifications.join("\n"), requiredSkills: job.requiredSkills.join(", "), preferredSkills: job.preferredSkills.join(", "),
    location: job.location ?? "", country: job.country ?? "", remotePolicy: job.remotePolicy, employmentType: job.employmentType, experienceMin: s(job.experienceMin), experienceMax: s(job.experienceMax), salaryMin: s(job.salaryMin), salaryMax: s(job.salaryMax), salaryCurrency: job.salaryCurrency ?? "", salaryPeriod: job.salaryPeriod ?? "YEAR",
    openings: String(job.openings), applicationDeadline: job.applicationDeadline ? job.applicationDeadline.toISOString().slice(0, 10) : "", visibility: job.visibility, campusHiring: job.campusHiring, eligibleGraduationYears: job.eligibleGraduationYears.join(", "), eligibleDegrees: job.eligibleDegrees.join(", "), eligibleProgrammeIds: job.eligibleProgrammeIds,
    interviewTemplateId: job.interviewTemplateId ?? "", competencyIds: job.competencies.map((c) => c.competencyId), screeningQuestions: (job.screeningQuestions as JobFormValue["screeningQuestions"]) ?? [], aiDraftUsed: job.aiDraftUsed,
  };
  return (
    <>
      <PageHeader title={`Edit: ${job.title}`} />
      <JobForm initial={initial} jobId={job.id} {...data} />
    </>
  );
}
