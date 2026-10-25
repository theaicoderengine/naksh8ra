import { requirePageOrg } from "@/server/auth/page";
import { prisma } from "@/server/db/client";
import { listStages } from "@/server/services/applications";
import { listDepartments } from "@/server/services/organisations";
import { getRetention, listOrgDataRequests } from "@/server/services/privacy";
import { listOrgAccommodations } from "@/server/services/students";
import { PageHeader, Card, CardBody } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { PermissionDenied } from "@/components/ui/feedback";
import { getOrgAiSettings } from "@/server/services/ai-settings";
import { AiProvidersSettings } from "@/components/workspace/ai-providers";
import { OrgProfileForm, PreferencesForm, StagesEditor, DepartmentsEditor, RetentionEditor, PrivacyRequests, Accommodations, SupportAccess } from "@/components/workspace/settings-forms";

export default async function Settings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug } = await params;
  const { tab = "profile" } = await searchParams;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("org.view")) return <PermissionDenied what="settings" />;
  const emp = ctx.org.type === "EMPLOYER";
  const tabs = [
    { key: "profile", label: "Organisation" },
    { key: "preferences", label: "Preferences" },
    ...(emp ? [{ key: "pipeline", label: "Pipeline stages" }, { key: "departments", label: "Departments" }] : []),
    { key: "retention", label: "Data retention" },
    ...(ctx.can("retention.manage") ? [{ key: "privacy", label: "Privacy requests" }] : []),
    ...(emp && ctx.can("candidates.view_all") ? [{ key: "accommodations", label: "Accommodations" }] : []),
    ...(emp && ctx.can("ai.manage") ? [{ key: "ai", label: "AI providers" }] : []),
    ...(ctx.can("support.approve_access") ? [{ key: "support", label: "Support access" }] : []),
  ];
  let body: React.ReactNode = null;
  if (tab === "profile" || tab === "preferences") {
    const o = await prisma.organisation.findUniqueOrThrow({ where: { id: ctx.org.id } });
    body = tab === "profile" ? <OrgProfileForm initial={JSON.parse(JSON.stringify(o))} /> : <PreferencesForm settings={(o.settings as Record<string, unknown>) ?? {}} />;
  } else if (tab === "pipeline") body = <StagesEditor stages={(await listStages(ctx)).map((s) => ({ id: s.id, name: s.name, kind: s.kind, position: s.position }))} />;
  else if (tab === "departments") body = <DepartmentsEditor items={(await listDepartments(ctx)).map((d) => ({ id: d.id, name: d.name }))} />;
  else if (tab === "retention") body = <RetentionEditor policies={await getRetention(ctx.org.id)} />;
  else if (tab === "privacy") body = <PrivacyRequests items={JSON.parse(JSON.stringify(await listOrgDataRequests(ctx)))} />;
  else if (tab === "accommodations") body = <Accommodations items={JSON.parse(JSON.stringify(await listOrgAccommodations(ctx.org.id)))} />;
  else if (tab === "ai") body = ctx.can("ai.manage") && emp ? <AiProvidersSettings data={JSON.parse(JSON.stringify(await getOrgAiSettings(ctx)))} /> : <PermissionDenied what="AI provider settings" />;
  else if (tab === "support") body = <SupportAccess items={JSON.parse(JSON.stringify(await prisma.supportAccessGrant.findMany({ where: { organisationId: ctx.org.id }, orderBy: { createdAt: "desc" }, take: 50 })))} />;
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs tabs={tabs} />
      <Card><CardBody className="p-6">{body}</CardBody></Card>
    </>
  );
}
