import { requirePlatformPage } from "@/server/auth/page";
import { listPlansAdmin } from "@/server/services/platform";
import { platformCan } from "@/server/rbac/permissions";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PlanEditor, PackEditor, emptyPlan, emptyPack } from "@/components/admin/plan-editor";
import { fmtMoney } from "@/lib/format";

export default async function Plans() {
  const s = await requirePlatformPage("platform.billing.view");
  const can = platformCan(s.user.platformRole, "platform.billing.manage");
  const { plans, packs } = await listPlansAdmin();
  return (
    <>
      <PageHeader title="Plans & credit packs" description="Pricing is configuration, not code." actions={can ? <PlanEditor initial={emptyPlan} label="New plan" /> : null} />
      <Table caption="Plans"><thead><tr><Th>Plan</Th><Th>Audience</Th><Th>Price</Th><Th>Entitlements</Th><Th>Stripe price</Th><Th>Subscribers</Th><Th /></tr></thead><tbody>
        {plans.map((p) => <Tr key={p.id}><Td><p className="font-medium">{p.name}</p><p className="font-mono text-xs text-subtle">{p.key}</p>{!p.isActive && <Badge tone="danger">inactive</Badge>}{!p.isPublic && <Badge>private</Badge>}</Td><Td>{p.audience.toLowerCase()}</Td><Td>{fmtMoney(p.priceAmount, p.currency)} / {p.interval.toLowerCase()}{p.trialDays ? <p className="text-xs text-subtle">{p.trialDays}d trial</p> : null}</Td><Td className="font-mono text-xs">{p.entitlements.map((e) => `${e.key}=${e.value}`).join(" · ")}</Td><Td className="font-mono text-xs">{p.stripePriceId ?? <Badge tone="warning">not set</Badge>}</Td><Td>{p._count.subscriptions}</Td>
          <Td>{can && <PlanEditor label="Edit" initial={{ key: p.key, name: p.name, description: p.description ?? "", audience: p.audience, interval: p.interval, priceAmount: String(p.priceAmount), currency: p.currency, stripePriceId: p.stripePriceId ?? "", trialDays: String(p.trialDays), isPublic: p.isPublic, isActive: p.isActive, sortOrder: String(p.sortOrder), entitlements: p.entitlements.map((e) => `${e.key}=${e.value}`).join("\n") }} />}</Td></Tr>)}
      </tbody></Table>
      <div className="mb-3 mt-8 flex items-center justify-between"><h2 className="text-lg font-semibold">Credit packs</h2>{can && <PackEditor initial={emptyPack} label="New pack" />}</div>
      <Table caption="Credit packs"><thead><tr><Th>Pack</Th><Th>Audience</Th><Th>Credits</Th><Th>Price</Th><Th>Expiry</Th><Th>Stripe price</Th><Th /></tr></thead><tbody>
        {packs.map((p) => <Tr key={p.id}><Td><p className="font-medium">{p.name}</p><p className="font-mono text-xs text-subtle">{p.key}</p></Td><Td>{p.audience.toLowerCase()}</Td><Td>{p.credits}</Td><Td>{fmtMoney(p.priceAmount, p.currency)}</Td><Td>{p.expiresInDays ? `${p.expiresInDays} days` : "never"}</Td><Td className="font-mono text-xs">{p.stripePriceId ?? <Badge tone="warning">not set</Badge>}</Td>
          <Td>{can && <PackEditor label="Edit" initial={{ key: p.key, name: p.name, credits: String(p.credits), priceAmount: String(p.priceAmount), currency: p.currency, stripePriceId: p.stripePriceId ?? "", audience: p.audience, expiresInDays: p.expiresInDays ? String(p.expiresInDays) : "", isActive: p.isActive }} />}</Td></Tr>)}
      </tbody></Table>
    </>
  );
}
