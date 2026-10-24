import { requirePageOrg } from "@/server/auth/page";
import { listTickets } from "@/server/services/platform";
import { PageHeader } from "@/components/ui/card";
import { Tickets } from "@/components/support/tickets";

export default async function Support({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageOrg(slug);
  const tickets = await listTickets({ requesterId: ctx.userId });
  return (<><PageHeader title="Support" description="Get help from the platform team." /><Tickets tickets={JSON.parse(JSON.stringify(tickets))} org={slug} me={ctx.userId} /></>);
}
