import { Badge } from "../ui/badge";
import { VerificationBadge } from "./job-card";
import { fmtDate, fmtSalary, titleCase } from "@/lib/format";
import type { PublicJob } from "@/server/services/jobs";

export function JobDetailBody({ job }: { job: PublicJob & { eligibility?: { eligible: boolean; reasons: string[]; unmet: string[] } } }) {
  const salary = fmtSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod);
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-subtle">{job.organisation.name}</span><VerificationBadge status={job.organisation.verificationStatus} /></div>
        <h1 className="mt-1 text-3xl font-semibold">{job.title}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{job.location ?? "Location not specified"}</Badge>
          <Badge>{titleCase(job.remotePolicy)}</Badge>
          <Badge>{titleCase(job.employmentType)}</Badge>
          {job.openings > 1 && <Badge>{job.openings} openings</Badge>}
          {salary && <Badge tone="success">{salary}</Badge>}
          {job.applicationDeadline && <Badge tone="warning">Apply by {fmtDate(job.applicationDeadline)}</Badge>}
          {(job.experienceMin != null || job.experienceMax != null) && <Badge>{job.experienceMin ?? 0}–{job.experienceMax ?? "+"} yrs experience</Badge>}
        </div>
      </div>
      <section><h2 className="mb-2 font-semibold">About the role</h2><p className="whitespace-pre-line text-sm leading-relaxed text-fg/90">{job.description}</p></section>
      {job.responsibilities && <section><h2 className="mb-2 font-semibold">Responsibilities</h2><p className="whitespace-pre-line text-sm leading-relaxed">{job.responsibilities}</p></section>}
      {job.requiredQualifications.length > 0 && <section><h2 className="mb-2 font-semibold">Required qualifications</h2><ul className="list-disc space-y-1 pl-5 text-sm">{job.requiredQualifications.map((q) => <li key={q}>{q}</li>)}</ul></section>}
      {(job.requiredSkills.length > 0 || job.preferredSkills.length > 0) && (
        <section>
          <h2 className="mb-2 font-semibold">Skills</h2>
          <div className="flex flex-wrap gap-1.5">{job.requiredSkills.map((s) => <Badge key={s} tone="primary">{s}</Badge>)}{job.preferredSkills.map((s) => <Badge key={s}>{s} (preferred)</Badge>)}</div>
        </section>
      )}
      {(job.eligibleGraduationYears.length > 0 || job.eligibleDegrees.length > 0) && (
        <section>
          <h2 className="mb-2 font-semibold">Eligibility</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {job.eligibleGraduationYears.length > 0 && <li>Graduation year: {job.eligibleGraduationYears.join(", ")}</li>}
            {job.eligibleDegrees.length > 0 && <li>Degree: {job.eligibleDegrees.join(" / ")}</li>}
          </ul>
        </section>
      )}
      {job.organisation.description && <section><h2 className="mb-2 font-semibold">About {job.organisation.name}</h2><p className="text-sm text-subtle">{job.organisation.description}</p></section>}
    </div>
  );
}
