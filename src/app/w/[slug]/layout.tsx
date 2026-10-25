import { requirePageOrg } from "@/server/auth/page";
import { listMyOrganisations } from "@/server/services/organisations";
import { getEntitlements } from "@/server/billing/entitlements";
import { prisma } from "@/server/db/client";
import { OrgProvider } from "@/components/workspace/org-context";
import { WorkspaceShell } from "@/components/workspace/shell";
import { UserMenu } from "@/components/app-shell/user-menu";
import { NotificationsBell } from "@/components/app-shell/notifications-bell";
import { Alert } from "@/components/ui/feedback";
import { describeAi } from "@/server/ai/access";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  if (ctx.session.activeOrgId !== ctx.org.id) await prisma.session.update({ where: { id: ctx.session.id }, data: { activeOrgId: ctx.org.id } });
  const [orgs, ent, ai] = await Promise.all([listMyOrganisations(ctx.userId), getEntitlements(ctx.org.id), ctx.org.type === "EMPLOYER" ? describeAi({ kind: "ORG", organisationId: ctx.org.id }, "ASSESSMENT") : null]);
  const canManageAi = ctx.permissions.has("ai.manage");
  const u = ctx.session.user;
  const banners = [] as React.ReactNode[];
  if (ent.status === "PAST_DUE") banners.push(<Alert key="pd" tone="danger" title="Payment failed">Update your payment method in Billing to avoid interruption.</Alert>);
  if (ai && !ai.available) banners.push(<Alert key="ai" tone="warning" title="AI is not set up for this organisation">AI assessments are unavailable: {ai.message} {canManageAi && <Link className="font-medium underline" href={`/w/${ctx.org.slug}/settings/ai`}>Open AI provider settings</Link>} Nothing is simulated.</Alert>);
  if (ai?.available && ai.resolution?.mode === "FIXTURE") banners.push(<Alert key="fx" tone="warning" title="Test mode: fixture AI provider">This deployment uses deterministic test fixtures instead of a real AI model. Results are labelled FIXTURE and must not be used for hiring.</Alert>);
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
