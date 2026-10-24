import Link from "next/link";
import { requirePlatformPage } from "@/server/auth/page";
import { listTickets } from "@/server/services/platform";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/format";

export default async function Tickets({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requirePlatformPage("platform.tickets");
  const { status } = await searchParams;
  const items = await listTickets({ status });
  return (
    <>
      <PageHeader title="Support queue" />
      <div className="mb-4 flex gap-2">{["", "OPEN", "PENDING", "RESOLVED", "CLOSED"].map((s) => <Link key={s} href={s ? `?status=${s}` : "?"} className={`rounded-full border px-3 py-1 text-sm ${(status ?? "") === s ? "border-primary bg-primary-soft text-primary" : "border-border text-subtle"}`}>{s || "All"}</Link>)}</div>
      <Table caption="Tickets"><thead><tr><Th>Subject</Th><Th>Organisation</Th><Th>Priority</Th><Th>Status</Th><Th>Updated</Th></tr></thead><tbody>
        {items.map((t) => <Tr key={t.id}><Td><Link className="font-medium hover:underline" href={`/admin/tickets/${t.id}`}>{t.subject}</Link></Td><Td>{t.organisation?.name ?? "—"}</Td><Td><Badge tone={t.priority === "URGENT" ? "danger" : t.priority === "HIGH" ? "warning" : "neutral"}>{t.priority.toLowerCase()}</Badge></Td><Td><StatusBadge status={t.status} /></Td><Td className="text-subtle">{fmtDateTime(t.updatedAt)}</Td></Tr>)}
      </tbody></Table>
    </>
  );
}
