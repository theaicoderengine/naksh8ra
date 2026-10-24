import Link from "next/link";
import { MapPin, Building2, CalendarClock, BadgeCheck, AlertCircle } from "lucide-react";
import { Badge } from "../ui/badge";
import { fmtDate, fmtSalary, titleCase } from "@/lib/format";

export type JobCardData = {
  id: string;
  title: string;
  location: string | null;
  remotePolicy: string;
  employmentType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  applicationDeadline: Date | string | null;
  campusHiring: boolean;
  requiredSkills: string[];
  organisation: { name: string; verificationStatus: string };
  eligibility?: { eligible: boolean; reasons: string[]; unmet: string[] };
  why?: string[];
  saved?: boolean;
};

export function VerificationBadge({ status }: { status: string }) {
  return status === "VERIFIED" ? (
    <Badge tone="success" title="Organisation identity verified by the platform"><BadgeCheck className="h-3 w-3" aria-hidden="true" />Verified employer</Badge>
  ) : (
    <Badge tone="neutral" title="This organisation has not completed verification">Unverified employer</Badge>
  );
}

export function JobCard({ job, href }: { job: JobCardData; href: string }) {
  const salary = fmtSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod);
  return (
    <Link href={href} className="block rounded-lg border border-border bg-surface p-5 transition-shadow hover:shadow-pop">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{job.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-subtle"><Building2 className="h-3.5 w-3.5" aria-hidden="true" />{job.organisation.name}</p>
        </div>
        <VerificationBadge status={job.organisation.verificationStatus} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-subtle">
        <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{job.location ?? "Location not specified"} · {titleCase(job.remotePolicy)}</span>
        <span>{titleCase(job.employmentType)}</span>
        {salary && <span>{salary}</span>}
        {job.applicationDeadline && <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />Apply by {fmtDate(job.applicationDeadline)}</span>}
      </div>
      {job.requiredSkills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">{job.requiredSkills.slice(0, 6).map((s) => <Badge key={s}>{s}</Badge>)}</div>
      )}
      {job.why && job.why.length > 0 && <p className="mt-3 text-xs text-accent">Why recommended: {job.why.join(" · ")}</p>}
      {job.eligibility && !job.eligibility.eligible && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-warning"><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />{job.eligibility.unmet.join(" · ")}</p>
      )}
    </Link>
  );
}
