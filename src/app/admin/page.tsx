import { platformOverview } from "@/server/services/platform";
import { PageHeader, Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { BarList } from "@/components/charts/bar-list";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { fmtMoney } from "@/lib/format";

export default async function AdminHome() {
  const o = await platformOverview();
  const mrr = Object.entries(o.mrrByCurrency);
  return (
    <>
      <PageHeader title="Platform overview" description="Aggregate metrics only. Tenant content (candidates, transcripts, recordings) is not accessible from here." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active users" value={o.users} hint={`${o.students} student profiles`} />
        <Stat label="Paid subscriptions" value={o.activePaidSubscriptions} hint={mrr.length ? `MRR ${mrr.map(([c, v]) => fmtMoney(v, c)).join(" · ")}` : "No paid MRR"} />
        <Stat label="Interviews (30 days)" value={o.interviewsLast30Days} hint={`${o.creditsConsumedLast30Days} credits consumed`} />
        <Stat label="Open support / privacy" value={`${o.health.openTickets} / ${o.health.openDataRequests}`} tone={o.health.openDataRequests > 0 ? "warning" : "default"} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Organisations by status" /><CardBody><BarList label="Organisations by status" rows={o.organisations.byStatus.map((s) => ({ key: s.status, label: s.status.toLowerCase().replace("_", " "), value: s._count._all }))} /></CardBody></Card>
        <Card><CardHeader title="Operational health (30 days)" /><CardBody className="grid grid-cols-3 gap-3 text-center">
          {[["Email failures", o.health.emailFailed30d], ["Failed jobs", o.health.jobsFailed30d], ["Failed payment events", o.health.paymentEventsFailed]].map(([l, v]) => <div key={String(l)}><p className={`text-2xl font-semibold tabular-nums ${Number(v) > 0 ? "text-danger" : ""}`}>{String(v)}</p><p className="text-xs text-subtle">{String(l)}</p></div>)}
        </CardBody></Card>
      </div>
      <Card className="mt-6"><CardHeader title="Provider cost estimate (30 days)" description="Estimated from usage × configured unit prices; verify against provider invoices." /><CardBody className="p-0">
        <Table caption="Provider costs"><thead><tr><Th>Type</Th><Th>Provider</Th><Th className="text-right">Units</Th><Th className="text-right">Est. cost (USD)</Th></tr></thead><tbody>
          {o.providerCostLast30Days.length === 0 ? <tr><Td colSpan={4} className="text-subtle">No provider usage recorded.</Td></tr> : o.providerCostLast30Days.map((c) => <Tr key={c.kind + c.provider}><Td>{c.kind}</Td><Td>{c.provider}</Td><Td className="text-right tabular-nums">{Math.round(c.units).toLocaleString()}</Td><Td className="text-right tabular-nums">${c.costUsd.toFixed(2)}</Td></Tr>)}
        </tbody></Table>
      </CardBody></Card>
    </>
  );
}
