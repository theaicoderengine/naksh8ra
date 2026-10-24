import { requirePageOrg } from "@/server/auth/page";
import { employerProgrammes } from "@/server/services/universities";
import { PageHeader } from "@/components/ui/card";
import { PermissionDenied } from "@/components/ui/feedback";
import { ProgrammeInvites } from "@/components/workspace/programme-invites";

export default async function Programmes({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("jobs.view_all")) return <PermissionDenied what="campus programmes" />;
  const items = await employerProgrammes(ctx);
  return (<><PageHeader title="Campus programmes" description="University placement programmes you've been invited to. Universities only see aggregate counts for consenting students — never your assessments, recordings or decisions." /><ProgrammeInvites items={JSON.parse(JSON.stringify(items))} /></>);
}
