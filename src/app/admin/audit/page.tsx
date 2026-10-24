import { requirePlatformPage } from "@/server/auth/page";
import { listAuditEvents, auditQuery } from "@/server/services/platform";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { fmtDateTime } from "@/lib/format";

export default async function AdminAudit({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePlatformPage("platform.security.view");
  const sp = await searchParams;
  const q = auditQuery.parse(sp);
  const r = await listAuditEvents(q);
  return (
    <>
      <PageHeader title="Security audit" />
      <form className="mb-4 flex flex-wrap gap-2"><input name="action" defaultValue={sp.action} placeholder="Action prefix (e.g. auth.)" aria-label="Action" className="h-10 w-64 rounded border border-border bg-surface px-3 text-sm" /><select name="result" defaultValue={sp.result ?? ""} aria-label="Result" className="h-10 rounded border border-border bg-surface px-3 text-sm"><option value="">Any result</option><option>FAILURE</option><option>DENIED</option><option>SUCCESS</option></select><button className="h-10 rounded bg-primary px-4 text-sm text-primary-fg">Filter</button></form>
      <Table caption="Audit events"><thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Org</Th><Th>IP</Th><Th>Result</Th></tr></thead><tbody>
        {r.items.map((e) => <Tr key={e.id}><Td className="whitespace-nowrap text-xs text-subtle">{fmtDateTime(e.createdAt)}</Td><Td className="text-xs">{e.actorEmail ?? e.actorType.toLowerCase()}</Td><Td className="font-mono text-xs">{e.action}{e.reason ? <p className="font-sans text-subtle">{e.reason}</p> : null}</Td><Td className="font-mono text-xs">{e.organisationId?.slice(0, 10) ?? "—"}</Td><Td className="text-xs">{e.ipAddress ?? "—"}</Td><Td><Badge tone={e.result === "SUCCESS" ? "success" : "danger"}>{e.result.toLowerCase()}</Badge></Td></Tr>)}
      </tbody></Table>
      <Pagination page={q.page} pageSize={100} total={r.total} basePath="/admin/audit" params={sp} />
    </>
  );
}
