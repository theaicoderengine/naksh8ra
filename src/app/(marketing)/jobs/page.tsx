import { Section } from "@/components/marketing";
import { JobCard } from "@/components/jobs/job-card";
import { JobFilters } from "@/components/jobs/job-filters";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { discoverJobs, discoverQuery } from "@/server/services/jobs";
import { currentSession } from "@/server/auth/session";

export const metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

export default async function JobBoard({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const q = discoverQuery.parse(sp);
  const session = await currentSession();
  const { items, total } = await discoverJobs(session?.user.id ?? null, q);
  return (
    <Section>
      <h1 className="text-3xl font-semibold">Open roles</h1>
      <p className="mt-2 text-subtle">Published vacancies from organisations on the platform. Employers marked “Unverified” have not completed identity verification.</p>
      <div className="mt-6"><JobFilters /></div>
      <div className="mt-6 grid gap-3">
        {items.length === 0 ? <EmptyState title="No roles match your search" description="Try removing a filter or searching for a broader keyword." /> : items.map((j) => <JobCard key={j.id} job={j} href={`/jobs/${j.id}`} />)}
      </div>
      <Pagination page={q.page} pageSize={q.pageSize} total={total} basePath="/jobs" params={sp} />
    </Section>
  );
}
