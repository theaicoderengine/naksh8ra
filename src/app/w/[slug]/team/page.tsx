import { requirePageOrg } from "@/server/auth/page";
import { listMembers } from "@/server/services/organisations";
import { getEntitlements, seatsUsed } from "@/server/billing/entitlements";
import { PageHeader } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/feedback";
import { TeamManager } from "@/components/workspace/team";

export default async function Team({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("members.view")) return <PermissionDenied what="the team" />;
  const [data, ent, used] = await Promise.all([listMembers(ctx), getEntitlements(ctx.org.id), seatsUsed(ctx.org.id)]);
  return (
    <>
      <PageHeader title="Team" description="Members, roles and invitations. Roles control what each person can see and do; recruiters and hiring managers only see vacancies they're assigned to." />
      <TeamManager members={JSON.parse(JSON.stringify(data.members))} invitations={JSON.parse(JSON.stringify(data.invitations))} roles={data.assignableRoles} me={ctx.userId} seats={{ used, limit: ent.seats }} />
    </>
  );
}
