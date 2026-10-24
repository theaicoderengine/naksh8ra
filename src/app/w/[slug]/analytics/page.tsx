import { redirect } from "next/navigation";
import { requirePageOrg } from "@/server/auth/page";
import { hrDashboard } from "@/server/services/analytics";
import { prisma } from "@/server/db/client";
import { PageHeader, Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { BarList } from "@/components/charts/bar-list";
import { PermissionDenied } from "@/components/ui/feedback";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { titleCase } from "@/lib/format";

export default async function Analytics({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("analytics.view")) return <PermissionDenied what="analytics" />;
  if (ctx.org.type === "UNIVERSITY") redirect(`/w/${slug}`);
  const d = await hrDashboard(ctx);
  const usage = ctx.can("billing.view") ? await prisma.usageRecord.groupBy({ by: ["kind", "provider", "unitLabel"], where: { organisationId: ctx.org.id, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, _sum: { units: true } }) : [];
  return (
    <>
      <PageHeader title="Analytics" description="Computed from your organisation's records (scoped to your vacancy access)." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Interviews invited (90d)" value={d.interviews.invitedLast90Days} />
        <Stat label="Completed (90d)" value={d.interviews.completedLast90Days} hint={d.interviews.completionRate == null ? undefined : `${Math.round(d.interviews.completionRate * 100)}% completion`} />
        <Stat label="Expired / failed (90d)" value={`${d.interviews.expired} / ${d.interviews.failed}`} />
        <Stat label="Median time to hire" value={d.timeToHireDays ? `${d.timeToHireDays.median} days` : "—"} hint={d.timeToHireDays ? `${d.timeToHireDays.count} hires in 90 days` : "No hires in 90 days"} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Hiring funnel" description="Current applications per stage" /><CardBody><BarList label="Applications by stage" rows={d.funnel.map((f) => ({ key: f.stageId, label: f.name, value: f.count }))} /></CardBody></Card>
        {usage.length > 0 && (
          <Card><CardHeader title="AI usage (30 days)" description="Provider units consumed on your behalf" /><CardBody className="p-0">
            <Table caption="AI usage"><thead><tr><Th>Type</Th><Th>Provider</Th><Th className="text-right">Units</Th></tr></thead><tbody>{usage.map((u) => <Tr key={`${u.kind}${u.provider}${u.unitLabel}`}><Td>{u.kind}</Td><Td>{u.provider}</Td><Td className="text-right tabular-nums">{Math.round(u._sum.units ?? 0).toLocaleString()} {titleCase(u.unitLabel)}</Td></Tr>)}</tbody></Table>
          </CardBody></Card>
        )}
      </div>
      <p className="mt-6 text-xs text-subtle">Per-vacancy competency distributions are on each vacancy&apos;s Analytics tab. Analytics never include demographic or protected-characteristic inference.</p>
    </>
  );
}
