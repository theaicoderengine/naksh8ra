import { requirePageOrg } from "@/server/auth/page";
import { listMyOrganisations } from "@/server/services/organisations";
import { getEntitlements } from "@/server/billing/entitlements";
import { prisma } from "@/server/db/client";
import { OrgProvider } from "@/components/workspace/org-context";
import { WorkspaceShell } from "@/components/workspace/shell";
import { UserMenu } from "@/components/app-shell/user-menu";
import { NotificationsBell } from "@/components/app-shell/notifications-bell";
import { Alert } from "@/components/ui/feedback";
import { llmStatus } from "@/server/providers/llm";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  if (ctx.session.activeOrgId !== ctx.org.id) await prisma.session.update({ where: { id: ctx.session.id }, data: { activeOrgId: ctx.org.id } });
  const [orgs, ent] = await Promise.all([listMyOrganisations(ctx.userId), getEntitlements(ctx.org.id)]);
  const ai = llmStatus();
  const u = ctx.session.user;
  const banners = [] as React.ReactNode[];
  if (ent.status === "PAST_DUE") banners.push(<Alert key="pd" tone="danger" title="Payment failed">Update your payment method in Billing to avoid interruption.</Alert>);
  if (!ai.configured && ctx.org.type === "EMPLOYER") banners.push(<Alert key="ai" tone="warning" title="AI provider not configured">AI interviews, assessments and drafting are unavailable until a platform administrator configures an AI provider. Nothing is simulated.</Alert>);
  if (ai.configured && ai.mode === "FIXTURE") banners.push(<Alert key="fx" tone="warning" title="Test mode: fixture AI provider">This deployment uses deterministic test fixtures instead of a real AI model. Results are labelled FIXTURE and must not be used for hiring.</Alert>);
  return (
    <OrgProvider value={{ slug: ctx.org.slug, name: ctx.org.name, type: ctx.org.type, role: ctx.roleKey, permissions: [...ctx.permissions] }}>
      <WorkspaceShell
        banner={banners.length ? <div className="mx-auto max-w-7xl space-y-2 px-4 pt-4 sm:px-6">{banners}</div> : null}
        header={
          <div className="flex items-center gap-1">
            <NotificationsBell />
            <UserMenu name={[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email} email={u.email} orgs={orgs.filter((o) => o.slug !== slug)} isStudent={u.isStudent} isPlatform={u.platformRole !== "NONE"} />
          </div>
        }
      >
        {children}
      </WorkspaceShell>
    </OrgProvider>
  );
}
