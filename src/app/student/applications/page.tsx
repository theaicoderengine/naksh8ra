import Link from "next/link";
import { requireVerifiedPage } from "@/server/auth/page";
import { listMyApplications } from "@/server/services/applications";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";

const LABEL: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "Submitted", IN_REVIEW: "In review", INTERVIEWING: "Interviewing", OFFER: "Offer stage", HIRED: "Successful", REJECTED: "Not progressing", WITHDRAWN: "Withdrawn" };

export default async function MyApplications() {
  const s = await requireVerifiedPage();
  const apps = await listMyApplications(s.user.id);
  return (
    <>
      <PageHeader title="Applications" />
      {apps.length === 0 ? <EmptyState title="No applications yet" action={<ButtonLink href="/student/jobs">Browse opportunities</ButtonLink>} /> : (
        <Table caption="My applications"><thead><tr><Th>Vacancy</Th><Th>Status</Th><Th>Interview</Th><Th>Submitted</Th></tr></thead><tbody>
          {apps.map((a) => <Tr key={a.id}><Td><Link className="font-medium hover:underline" href={a.status === "DRAFT" ? `/student/jobs/${a.jobId}` : `/student/applications/${a.id}`}>{a.job?.title ?? "Vacancy"}</Link><p className="text-xs text-subtle">{a.job?.organisation}</p></Td><Td><StatusBadge status={a.status} label={LABEL[a.status]} /></Td><Td>{a.interviews[0] ? <StatusBadge status={a.interviews[0].status} /> : "—"}</Td><Td className="text-subtle">{fmtDate(a.submittedAt)}</Td></Tr>)}
        </tbody></Table>
      )}
    </>
  );
}
