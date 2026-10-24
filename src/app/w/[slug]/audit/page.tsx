import Link from "next/link";
import { requirePageOrg } from "@/server/auth/page";
import { listAuditEvents, auditQuery } from "@/server/services/platform";
import { PageHeader } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PermissionDenied } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { fmtDateTime } from "@/lib/format";

export default async function Audit({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePageOrg(slug);
  if (!ctx.can("audit.view")) return <PermissionDenied what="the audit log" />;
  const q = auditQuery.parse(sp);
  const r = await listAuditEvents(q, ctx.org.id);
  const prefixes = ["", "job", "application", "interview", "assessment", "member", "candidates", "privacy", "platform", "billing", "subscription", "file", "auth"];
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sensitive actions in this workspace, including platform-administrator actions." />
      <div className="mb-4 flex flex-wrap gap-2">{prefixes.map((p) => <Link key={p} href={p ? `?action=${p}` : "?"} className={`rounded-full border px-3 py-1 text-sm ${(sp.action ?? "") === p ? "border-primary bg-primary-soft text-primary" : "border-border text-subtle hover:bg-muted"}`}>{p || "All"}</Link>)}</div>
      <Table caption="Audit events">
        <thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Target</Th><Th>Reason</Th><Th>Result</Th></tr></thead>
        <tbody>{r.items.map((e) => (
          <Tr key={e.id}>
            <Td className="whitespace-nowrap text-subtle">{fmtDateTime(e.createdAt)}</Td>
            <Td>{e.actorEmail ?? e.actorType.toLowerCase()}{e.actorType === "PLATFORM_ADMIN" && <Badge tone="warning" className="ml-1">platform</Badge>}</Td>
            <Td className="font-mono text-xs">{e.action}</Td>
            <Td className="text-xs text-subtle">{e.targetType ? `${e.targetType}` : "—"}</Td>
            <Td className="max-w-xs text-xs text-subtle">{e.reason ?? ""}</Td>
            <Td><Badge tone={e.result === "SUCCESS" ? "success" : "danger"}>{e.result.toLowerCase()}</Badge></Td>
          </Tr>))}</tbody>
      </Table>
      <Pagination page={q.page} pageSize={100} total={r.total} basePath={`/w/${slug}/audit`} params={sp} />
    </>
  );
}
