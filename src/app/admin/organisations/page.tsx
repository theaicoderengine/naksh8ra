import Link from "next/link";
import { listOrganisations, orgQuery } from "@/server/services/platform";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { fmtDate } from "@/lib/format";

export default async function AdminOrgs({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const q = orgQuery.parse(sp);
  const r = await listOrganisations(q);
  return (
    <>
      <PageHeader title="Organisations" />
      <form className="mb-4 flex gap-2"><input name="q" defaultValue={sp.q} placeholder="Search name or slug" aria-label="Search organisations" className="h-10 w-72 rounded border border-border bg-surface px-3 text-sm" /><select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-10 rounded border border-border bg-surface px-3 text-sm"><option value="">Any status</option><option>ACTIVE</option><option>SUSPENDED</option><option>CLOSED</option></select><button className="h-10 rounded bg-primary px-4 text-sm text-primary-fg">Search</button></form>
      <Table caption="Organisations"><thead><tr><Th>Organisation</Th><Th>Type</Th><Th>Status</Th><Th>Verification</Th><Th className="text-right">Members</Th><Th>Created</Th></tr></thead><tbody>
        {r.items.map((o) => <Tr key={o.id}><Td><Link className="font-medium hover:underline" href={`/admin/organisations/${o.id}`}>{o.name}</Link><p className="font-mono text-xs text-subtle">{o.slug}</p></Td><Td><Badge>{o.type.toLowerCase()}</Badge></Td><Td><StatusBadge status={o.status} /></Td><Td><StatusBadge status={o.verificationStatus} /></Td><Td className="text-right">{o._count.memberships}</Td><Td className="text-subtle">{fmtDate(o.createdAt)}</Td></Tr>)}
      </tbody></Table>
      <Pagination page={q.page} pageSize={50} total={r.total} basePath="/admin/organisations" params={sp} />
    </>
  );
}
