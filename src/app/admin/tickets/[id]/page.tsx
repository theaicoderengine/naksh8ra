import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformPage } from "@/server/auth/page";
import { getTicket } from "@/server/services/platform";
import { PageHeader, Card, CardBody } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { TicketReply } from "@/components/admin/ticket-reply";
import { fmtDateTime } from "@/lib/format";

export default async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePlatformPage("platform.tickets");
  const t = await getTicket(id, { admin: true }).catch(() => notFound());
  return (
    <>
      <PageHeader breadcrumb={<Link href="/admin/tickets" className="hover:underline">Support</Link>} title={t.subject} description={`${t.organisation?.name ?? "No organisation"} · ${fmtDateTime(t.createdAt)}`} actions={<StatusBadge status={t.status} />} />
      <Card><CardBody className="space-y-4">
        <p className="whitespace-pre-line text-sm">{t.body}</p>
        <ul className="space-y-2">{t.messages.map((m) => <li key={m.id} className={`rounded p-3 text-sm ${m.internal ? "border border-warning/40 bg-warning-soft" : "bg-muted"}`}>{m.internal && <Badge tone="warning">internal</Badge>}<p className="whitespace-pre-line">{m.body}</p><p className="mt-1 text-xs text-subtle">{fmtDateTime(m.createdAt)}</p></li>)}</ul>
        <TicketReply id={t.id} status={t.status} />
      </CardBody></Card>
    </>
  );
}
