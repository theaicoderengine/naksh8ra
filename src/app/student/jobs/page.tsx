import { requireVerifiedPage } from "@/server/auth/page";
import { discoverJobs, discoverQuery } from "@/server/services/jobs";
import { PageHeader } from "@/components/ui/card";
import { JobCard } from "@/components/jobs/job-card";
import { JobFilters } from "@/components/jobs/job-filters";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";

export default async function StudentJobs({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const s = await requireVerifiedPage();
  const q = discoverQuery.parse(sp);
  const { items, total } = await discoverJobs(s.user.id, q);
  return (
    <>
      <PageHeader title="Opportunities" description="Public and campus vacancies. Eligibility is explained using only your stated qualifications." />
      <JobFilters showEligible />
      <div className="mt-6 grid gap-3">{items.length === 0 ? <EmptyState title="No matching opportunities" description="Try different keywords or remove a filter." /> : items.map((j) => <JobCard key={j.id} job={j} href={`/student/jobs/${j.id}`} />)}</div>
      <Pagination page={q.page} pageSize={q.pageSize} total={total} basePath="/student/jobs" params={sp} />
    </>
  );
}
