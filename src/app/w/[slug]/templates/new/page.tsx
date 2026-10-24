import { requirePageOrg } from "@/server/auth/page";
import { listCompetencies } from "@/server/services/templates";
import { getEntitlements } from "@/server/billing/entitlements";
import { PageHeader } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/feedback";
import { TemplateEditor, emptyTemplate } from "@/components/workspace/template-editor";

export default async function NewTemplate({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("interviews.configure")) return <PermissionDenied what="interview templates" />;
  const [comps, ent] = await Promise.all([listCompetencies(ctx), getEntitlements(ctx.org.id)]);
  return (<><PageHeader title="New interview template" /><TemplateEditor initial={emptyTemplate} competencies={comps.map((c) => ({ id: c.id, name: c.name }))} realtimeAllowed={ent.raw["feature.realtime_interviews"] !== "false"} /></>);
}
