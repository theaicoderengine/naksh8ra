import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformPage } from "@/server/auth/page";
import { getOrgAiAccess } from "@/server/services/ai-admin";
import { PageHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/feedback";
import { AiGrantEditor } from "@/components/admin/ai-access";
import { AiAccessPanels } from "@/components/admin/ai-detail";

export default async function OrgAiAccess({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePlatformPage("platform.ai.view");
  const d = await getOrgAiAccess(s, id).catch(() => notFound());
  const enabled = d.grants.filter((g) => g.enabled).length;
  return (
    <>
      <PageHeader
        breadcrumb={<><Link href="/admin/ai" className="hover:underline">AI access</Link> / <Link href={`/admin/organisations/${d.organisation.id}`} className="hover:underline">{d.organisation.name}</Link></>}
        title={<span className="flex items-center gap-2">AI access — {d.organisation.name} <StatusBadge status={d.organisation.status} /></span>}
        description={<span>Organisation ID <span className="font-mono">{d.organisation.id}</span> · Platform AI: {enabled ? <Badge tone="success">{enabled} grant{enabled > 1 ? "s" : ""} active</Badge> : <Badge>not enabled</Badge>}</span>}
      />
      <Alert tone="info" className="mb-6">Platform-funded AI is off unless granted here, per capability and provider. Changes apply to the next AI operation, including background jobs already queued. The organisation&apos;s own keys keep working regardless of these grants.</Alert>
      <AiGrantEditor endpoint={`/platform/organisations/${d.organisation.id}/ai/grants`} capabilities={d.capabilities} grants={JSON.parse(JSON.stringify(d.grants))} catalog={d.catalog} deployment={d.deployment} canManage={d.canManage} />
      <AiAccessPanels usage={d.usage} recentErrors={d.recentErrors} history={JSON.parse(JSON.stringify(d.history))} orgCredentials={JSON.parse(JSON.stringify(d.orgCredentials))} routes={d.routes} />
    </>
  );
}
