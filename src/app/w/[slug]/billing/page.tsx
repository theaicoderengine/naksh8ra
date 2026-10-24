import { requirePageOrg } from "@/server/auth/page";
import { billingOverview, listPublicPlans } from "@/server/services/billing";
import { PageHeader, Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Alert, PermissionDenied } from "@/components/ui/feedback";
import { CheckoutButton, PortalButton } from "@/components/workspace/billing-actions";
import { fmtDate, fmtDateTime, fmtMoney, titleCase } from "@/lib/format";

export default async function Billing({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ checkout?: string }> }) {
  const { slug } = await params;
  const { checkout } = await searchParams;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("billing.view")) return <PermissionDenied what="billing" />;
  const [b, catalog] = await Promise.all([billingOverview(ctx), listPublicPlans(ctx.org.type === "UNIVERSITY" ? "UNIVERSITY" : "EMPLOYER")]);
  const sub = b.subscription;
  return (
    <>
      <PageHeader title="Billing & credits" description="Subscription, seats, interview credits and invoices. Payments are handled on our payment provider's hosted pages; we never see card details." actions={b.paymentsConfigured && sub?.provider === "stripe" ? <PortalButton /> : null} />
      {checkout === "success" && <Alert tone="success" className="mb-4" title="Payment received">Your purchase is being confirmed. Credits and plan changes appear here once our payment provider confirms them (usually within seconds).</Alert>}
      {checkout === "cancelled" && <Alert className="mb-4">Checkout was cancelled. No charge was made.</Alert>}
      {!b.paymentsConfigured && <Alert tone="warning" className="mb-4" title="Payments not configured">This deployment has no payment provider configured, so purchases are unavailable. A platform administrator can adjust credits manually.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Plan" value={b.entitlements.planName ?? "No plan"} hint={sub ? `${titleCase(sub.status)}${sub.trialEndsAt ? ` · trial ends ${fmtDate(sub.trialEndsAt)}` : ` · renews ${fmtDate(sub.currentPeriodEnd)}`}` : "Default limits apply"} />
        <Stat label="Seats" value={`${b.seats.used} / ${b.seats.limit}`} tone={b.seats.used >= b.seats.limit ? "warning" : "default"} />
        <Stat label="Credits available" value={b.credits.available} hint={`${b.credits.reserved} reserved`} tone={b.credits.available < 3 ? "warning" : "default"} />
        <Stat label="Credits used (30 days)" value={b.credits.consumedLast30Days} />
      </div>
      {sub?.cancelAtPeriodEnd && <Alert tone="warning" className="mt-4">Your subscription is set to cancel on {fmtDate(sub.currentPeriodEnd)}.</Alert>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Plans" description="Monthly credit allowances are added on each paid renewal." /><CardBody className="space-y-3">
          {catalog.plans.length === 0 && <p className="text-sm text-subtle">No plans are configured.</p>}
          {catalog.plans.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
              <div><p className="font-medium">{p.name} {b.entitlements.planKey === p.key && <Badge tone="success">Current</Badge>}</p><p className="text-subtle">{p.priceAmount ? `${fmtMoney(p.priceAmount, p.currency)} / ${p.interval.toLowerCase()}` : "Price on request"} · {p.entitlements.filter((e) => ["seats", "monthly_interview_credits"].includes(e.key)).map((e) => `${e.value} ${e.key.replace(/_/g, " ")}`).join(" · ")}</p></div>
              {b.paymentsConfigured && p.stripePriceId && b.entitlements.planKey !== p.key && (sub?.provider !== "stripe" || sub.status === "CANCELED") && <CheckoutButton planKey={p.key} label="Subscribe" />}
            </div>
          ))}
          {sub?.provider === "stripe" && sub.status !== "CANCELED" && <p className="text-xs text-subtle">To change or cancel your plan, use “Manage billing”.</p>}
        </CardBody></Card>
        <Card><CardHeader title="Credit packs" description="One credit = one employer interview that the candidate actually answers." /><CardBody className="space-y-3">
          {catalog.packs.length === 0 && <p className="text-sm text-subtle">No credit packs are configured.</p>}
          {catalog.packs.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
              <div><p className="font-medium">{p.name}</p><p className="text-subtle">{p.priceAmount ? fmtMoney(p.priceAmount, p.currency) : "Price on request"}{p.expiresInDays ? ` · expires ${p.expiresInDays} days after purchase` : " · no expiry"}</p></div>
              {b.paymentsConfigured && p.stripePriceId && <CheckoutButton packKey={p.key} label="Buy" variant="secondary" />}
            </div>
          ))}
        </CardBody></Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Credit ledger</h2>
      <Table caption="Credit ledger">
        <thead><tr><Th>Date</Th><Th>Entry</Th><Th className="text-right">Available Δ</Th><Th className="text-right">Reserved Δ</Th><Th className="text-right">Balance</Th><Th>Reference</Th></tr></thead>
        <tbody>{b.ledger.length === 0 ? <tr><Td colSpan={6} className="text-subtle">No credit activity yet.</Td></tr> : b.ledger.map((l) => (
          <Tr key={l.id}><Td className="whitespace-nowrap text-subtle">{fmtDateTime(l.createdAt)}</Td><Td>{titleCase(l.type)}{l.reason ? <span className="text-xs text-subtle"> · {l.reason}</span> : null}</Td><Td className="text-right tabular-nums">{l.amountAvailable > 0 ? `+${l.amountAvailable}` : l.amountAvailable}</Td><Td className="text-right tabular-nums">{l.amountReserved > 0 ? `+${l.amountReserved}` : l.amountReserved}</Td><Td className="text-right tabular-nums">{l.balanceAvailable} <span className="text-xs text-subtle">({l.balanceReserved} res.)</span></Td><Td className="max-w-[12rem] truncate font-mono text-xs text-subtle">{l.reference}</Td></Tr>
        ))}</tbody>
      </Table>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Invoices</h2>
      <Table caption="Invoices">
        <thead><tr><Th>Number</Th><Th>Period</Th><Th>Status</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
        <tbody>{b.invoices.length === 0 ? <tr><Td colSpan={5} className="text-subtle">No invoices yet.</Td></tr> : b.invoices.map((i) => (
          <Tr key={i.id}><Td>{i.number ?? "—"}</Td><Td className="text-subtle">{fmtDate(i.periodStart)} – {fmtDate(i.periodEnd)}</Td><Td><StatusBadge status={i.status} /></Td><Td className="text-right">{fmtMoney(i.amountDue, i.currency)}</Td><Td className="text-right">{i.hostedUrl && <a className="text-primary hover:underline" href={i.hostedUrl} target="_blank" rel="noreferrer">View</a>}</Td></Tr>
        ))}</tbody>
      </Table>
    </>
  );
}
