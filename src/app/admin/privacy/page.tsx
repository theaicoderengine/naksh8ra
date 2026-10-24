import { requirePlatformPage } from "@/server/auth/page";
import { listDataRequestsAdmin } from "@/server/services/platform";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/format";

export default async function AdminPrivacy() {
  await requirePlatformPage("platform.privacy.manage");
  const items = await listDataRequestsAdmin();
  return (
    <>
      <PageHeader title="Data subject requests" description="Account-level requests are processed automatically; requests forwarded to employers are actioned by those organisations." />
      <Table caption="Data subject requests"><thead><tr><Th>Received</Th><Th>Type</Th><Th>Scope</Th><Th>Status</Th><Th>Due</Th><Th>Deletion job</Th></tr></thead><tbody>
        {items.map((r) => <Tr key={r.id}><Td className="text-subtle">{fmtDate(r.createdAt)}</Td><Td>{r.type.toLowerCase()}</Td><Td>{r.organisationId ? <Badge>employer</Badge> : <Badge tone="primary">platform account</Badge>}</Td><Td><StatusBadge status={r.status} /></Td><Td className={r.dueAt < new Date() && r.status !== "COMPLETED" ? "text-danger" : ""}>{fmtDate(r.dueAt)}</Td><Td>{r.deletionJob ? <StatusBadge status={r.deletionJob.status} /> : "—"}</Td></Tr>)}
      </tbody></Table>
    </>
  );
}
