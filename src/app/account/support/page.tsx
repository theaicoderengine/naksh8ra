import { requirePageSession } from "@/server/auth/page";
import { listTickets } from "@/server/services/platform";
import { PageHeader } from "@/components/ui/card";
import { Tickets } from "@/components/support/tickets";

export default async function AccountSupport() {
  const s = await requirePageSession();
  const t = await listTickets({ requesterId: s.user.id });
  return (<><PageHeader title="Support" /><Tickets tickets={JSON.parse(JSON.stringify(t))} me={s.user.id} /></>);
}
