import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformPage } from "@/server/auth/page";
import { organisationDetail } from "@/server/services/platform";
import { platformCan } from "@/server/rbac/permissions";
import { headers } from "next/headers";
import { PageHeader, Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/feedback";
import { OrgActions, CreditAdjust, RequestSupportAccess } from "@/components/admin/org-actions";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";

export default async function AdminOrg({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePlatformPage();
  const h = await headers();
  const d = await organisationDetail(id, s, { ip: h.get("x-forwarded-for"), userAgent: h.get("user-agent"), requestId: "page" }).catch(() => notFound());
  const role = s.user.platformRole;
  return (
    <>
      <PageHeader breadcrumb={<Link href="/admin/organisations" className="hover:underline">Organisations</Link>} title={<span className="flex items-center gap-2">{d.org.name}<StatusBadge status={d.org.status} /><StatusBadge status={d.org.verificationStatus} /></span>} description={`${d.org.slug} · ${d.org.type.toLowerCase()} · created ${fmtDate(d.org.createdAt)}`} actions={platformCan(role, "platform.orgs.manage") ? <OrgActions id={d.org.id} status={d.org.status} verification={d.org.verificationStatus} /> : null} />
      <Alert tone="info" className="mb-6">Viewing this page is recorded in the organisation&apos;s audit log.</Alert>
      {d.org.verificationNotes && <Alert tone="warning" className="mb-6" title="Verification notes">{d.org.verificationNotes}</Alert>}
      {d.org.suspendedReason && <Alert tone="danger" className="mb-6" title={`Suspended ${fmtDate(d.org.suspendedAt)}`}>{d.org.suspendedReason}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Members" value={d.stats.members} /><Stat label="Jobs" value={d.stats.jobs} /><Stat label="Applications" value={d.stats.applications} /><Stat label="Interviews" value={d.stats.interviews} /><Stat label="Credits" value={d.stats.credits.available} hint={`${d.stats.credits.reserved} reserved`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Account" /><CardBody className="space-y-1.5 text-sm">
          <p><span className="text-subtle">Owners:</span> {d.owners.join(", ")}</p>
          <p><span className="text-subtle">Billing email:</span> {d.org.billingEmail ?? "—"}</p>
          <p><span className="text-subtle">Website:</span> {d.org.website ?? "—"}</p>
          <p><span className="text-subtle">Country / region:</span> {d.org.country ?? "—"} / {d.org.dataRegion}</p>
          <p><span className="text-subtle">Payment customer:</span> <span className="font-mono text-xs">{d.org.stripeCustomerId ?? "—"}</span></p>
        </CardBody></Card>
        <Card><CardHeader title="Subscriptions" /><CardBody className="space-y-2 text-sm">{d.stats.subscriptions.length === 0 ? <p className="text-subtle">None</p> : d.stats.subscriptions.map((x) => <p key={x.id}>{x.plan.name} <StatusBadge status={x.status} /> <span className="text-xs text-subtle">{x.provider} · until {fmtDate(x.currentPeriodEnd)}</span></p>)}</CardBody></Card>
        {platformCan(role, "platform.billing.manage") && (
          <Card><CardHeader title="Credits" description="Last 20 ledger entries" /><CardBody className="space-y-4">
            <CreditAdjust id={d.org.id} />
            <ul className="space-y-1 text-xs">{d.stats.ledger.map((l) => <li key={l.id} className="flex justify-between"><span>{fmtDateTime(l.createdAt)} · {titleCase(l.type)}{l.reason ? ` — ${l.reason}` : ""}</span><span className="tabular-nums">{l.amountAvailable > 0 ? "+" : ""}{l.amountAvailable} → {l.balanceAvailable}</span></li>)}</ul>
          </CardBody></Card>
        )}
        <Card><CardHeader title="Support access" description="Metadata-only, owner-approved, 24h" /><CardBody className="space-y-3">
          <RequestSupportAccess id={d.org.id} />
          <ul className="space-y-1 text-sm">{d.supportGrants.map((g) => <li key={g.id}><StatusBadge status={g.status} /> {g.reason} <span className="text-xs text-subtle">{fmtDate(g.createdAt)}{g.expiresAt ? ` · expires ${fmtDateTime(g.expiresAt)}` : ""}</span></li>)}</ul>
          <p className="text-xs text-subtle">There is no “view as user” capability. <Badge>by design</Badge></p>
        </CardBody></Card>
      </div>
    </>
  );
}
