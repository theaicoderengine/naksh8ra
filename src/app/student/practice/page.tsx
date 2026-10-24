import Link from "next/link";
import { requireVerifiedPage } from "@/server/auth/page";
import { listPractice, practiceBalance, practiceProgress } from "@/server/services/practice";
import { listPublicPlans } from "@/server/services/billing";
import { PageHeader, Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, Alert } from "@/components/ui/feedback";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { BuyPracticeCredits } from "@/components/student/practice";
import { fmtDate } from "@/lib/format";
import { env } from "@/server/env";

const lvl = (n: number | null) => (n == null ? "—" : n >= 2.5 ? "High" : n >= 1.75 ? "Medium" : "Low");

export default async function Practice({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const s = await requireVerifiedPage();
  const [items, bal, progress, catalog] = await Promise.all([listPractice(s.user.id), practiceBalance(s.user.id), practiceProgress(s.user.id), listPublicPlans("STUDENT")]);
  const paymentsOn = env().PAYMENT_PROVIDER === "stripe" && !!env().STRIPE_SECRET_KEY;
  return (
    <>
      <PageHeader title="Practice interviews" description="Private AI coaching. Employers never see practice sessions, and they're never used for hiring decisions." actions={<ButtonLink href="/student/practice/new">New practice</ButtonLink>} />
      {checkout === "success" && <Alert tone="success" className="mb-4">Thanks — your practice credits will appear once payment is confirmed.</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Practice sessions available" value={bal.available} hint="Includes this month's free allowance" />
        <Stat label="Completed" value={progress.length} />
        <Stat label="Latest clarity" value={lvl(progress.at(-1)?.clarity ?? null)} />
      </div>
      {bal.available === 0 && paymentsOn && <Card className="mt-4"><CardBody className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">You&apos;ve used your free sessions this month.</p><BuyPracticeCredits packs={catalog.packs.filter((p) => p.stripePriceId).map((p) => ({ key: p.key, name: p.name }))} /></CardBody></Card>}
      {progress.length > 1 && (
        <Card className="mt-6"><CardHeader title="Your progress" description="Average across questions in each session (low / medium / high)" /><CardBody className="p-0">
          <Table caption="Practice progress"><thead><tr><Th>Date</Th><Th>Role</Th><Th>Relevance</Th><Th>Clarity</Th><Th>Completeness</Th></tr></thead><tbody>{progress.map((p) => <Tr key={p.id}><Td>{fmtDate(p.date)}</Td><Td>{p.role}</Td><Td>{lvl(p.relevance)}</Td><Td>{lvl(p.clarity)}</Td><Td>{lvl(p.completeness)}</Td></Tr>)}</tbody></Table>
        </CardBody></Card>
      )}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Sessions</h2>
      {items.length === 0 ? <EmptyState title="No practice yet" description="Pick a target role and answer a few questions to get coaching feedback." action={<ButtonLink href="/student/practice/new">Start practising</ButtonLink>} /> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{items.map((p) => <li key={p.id} className="flex items-center justify-between gap-3 p-4 text-sm"><div><Link href={`/student/practice/${p.id}`} className="font-medium hover:underline">{p.targetRole}</Link><p className="text-xs text-subtle">{fmtDate(p.createdAt)}{p.feedback ? ` · ${p.feedback.summary.slice(0, 80)}…` : ""}</p></div><StatusBadge status={p.status} /></li>)}</ul>
      )}
    </>
  );
}
