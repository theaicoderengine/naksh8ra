import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquareQuote } from "lucide-react";
import { requireVerifiedPage } from "@/server/auth/page";
import { getMyApplication } from "@/server/services/applications";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { WithdrawButton } from "@/components/student/withdraw";
import { fmtDate, fmtDateTime } from "@/lib/format";

const LABEL: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "Submitted", IN_REVIEW: "In review", INTERVIEWING: "Interviewing", OFFER: "Offer stage", HIRED: "Successful", REJECTED: "Not progressing", WITHDRAWN: "Withdrawn" };

export default async function MyApplication({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireVerifiedPage();
  const a = await getMyApplication(s.user.id, id).catch(() => notFound());
  return (
    <>
      <PageHeader breadcrumb={<Link className="hover:underline" href="/student/applications">Applications</Link>} title={a.job?.title ?? "Application"} description={`${a.job?.organisation.name ?? ""} · submitted ${fmtDate(a.submittedAt)}`} actions={<><StatusBadge status={a.status} label={LABEL[a.status]} />{a.canWithdraw && a.status !== "DRAFT" && <WithdrawButton id={a.id} />}</>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card><CardHeader title="Interviews" /><CardBody className="space-y-3">
            {a.interviews.length === 0 ? <p className="text-sm text-subtle">No interviews yet. If the employer invites you, it will appear here and you&apos;ll get an email.</p> : a.interviews.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                <div><p className="font-medium">{i.name}</p><p className="text-xs text-subtle">{i.mode === "REALTIME_CONVERSATIONAL" ? "Conversational voice interview" : "Question-by-question interview"} · about {i.minutes} min · due {fmtDate(i.expiresAt)}</p></div>
                <div className="flex items-center gap-2"><StatusBadge status={i.status} />{["PENDING", "IN_PROGRESS"].includes(i.status) && <ButtonLink size="sm" href={`/interview/i/${i.id}`}>{i.status === "IN_PROGRESS" ? "Resume" : "Start"}</ButtonLink>}</div>
              </div>
            ))}
          </CardBody></Card>
          <Card><CardHeader title="Feedback from the employer" description="Only feedback the hiring team has chosen to share appears here." /><CardBody>
            {a.feedback.length === 0 ? <p className="text-sm text-subtle">No feedback has been shared.</p> : a.feedback.map((f) => <div key={f.id} className="flex gap-3 rounded-lg bg-muted/60 p-4 text-sm"><MessageSquareQuote className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><div><p className="whitespace-pre-line">{f.body}</p><p className="mt-1 text-xs text-subtle">{fmtDate(f.approvedAt)}</p></div></div>)}
          </CardBody></Card>
        </div>
        <Card><CardHeader title="Timeline" /><CardBody>
          <ol className="space-y-3 border-l border-border pl-4 text-sm">{a.history.map((h, i) => <li key={i}><StatusBadge status={h.toStatus} label={LABEL[h.toStatus]} /><p className="mt-0.5 text-xs text-subtle">{fmtDateTime(h.createdAt)}</p></li>)}</ol>
        </CardBody></Card>
      </div>
    </>
  );
}
