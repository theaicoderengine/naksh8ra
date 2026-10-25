import Link from "next/link";
import { requirePlatformPage } from "@/server/auth/page";
import { listOrgAiAccess } from "@/server/services/ai-admin";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/form";
import { providerLabel } from "@/lib/ai-labels";

export default async function AdminAi({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requirePlatformPage("platform.ai.view");
  const { q } = await searchParams;
  const d = await listOrgAiAccess(s, q?.slice(0, 100));
  return (
    <>
      <PageHeader title="AI access" description="Platform-funded AI is denied by default. Grant it per organisation, provider and capability. Organisations may also connect their own keys." />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card><CardHeader title="Deployment credentials" description="Platform-owned keys from the environment (values never shown)." /><CardBody className="space-y-1 text-sm">
          {d.deployment.llm.filter((p) => p.provider !== "FIXTURE" || p.configured).map((p) => <p key={p.provider}>{providerLabel(p.provider)} {p.configured ? <Badge tone="success">{p.defaultModel}</Badge> : <Badge>not configured</Badge>}{d.deployment.defaultProvider === p.provider && <Badge className="ml-1">default</Badge>}</p>)}
          <p>Speech-to-text {d.deployment.transcription ? <Badge tone="success">{providerLabel(d.deployment.transcription)}</Badge> : <Badge>not configured</Badge>}</p>
          <p>Text-to-speech {d.deployment.speechSynthesis ? <Badge tone="success">{providerLabel(d.deployment.speechSynthesis)}</Badge> : <Badge>browser voice</Badge>}</p>
        </CardBody></Card>
        <Card><CardHeader title="Personal accounts" description="Student practice and resume parsing" /><CardBody><Link className="text-sm font-medium text-primary hover:underline" href="/admin/ai/personal">Manage personal-account AI access →</Link></CardBody></Card>
      </div>
      <form className="mb-3 max-w-sm"><label htmlFor="q" className="sr-only">Search organisations</label><Input id="q" name="q" defaultValue={q ?? ""} placeholder="Search by name, slug or ID" /></form>
      <Table caption="Organisations' AI access">
        <thead><tr><Th>Organisation</Th><Th>ID</Th><Th>Platform AI</Th><Th>Own keys</Th><Th /></tr></thead>
        <tbody>
          {d.organisations.length === 0 ? <tr><Td colSpan={5} className="text-subtle">No employer organisations.</Td></tr> : d.organisations.map((o) => (
            <Tr key={o.id}>
              <Td><span className="font-medium">{o.name}</span> <StatusBadge status={o.status} /></Td>
              <Td className="font-mono text-xs">{o.id}</Td>
              <Td>{o.platformGrants ? <Badge tone="success">{o.platformGrants} grant{o.platformGrants > 1 ? "s" : ""}</Badge> : <Badge>denied (default)</Badge>}</Td>
              <Td className="text-xs">{o.orgKeys.length ? o.orgKeys.map((k) => `${providerLabel(k.provider)}${k.status === "INVALID" ? " (invalid)" : ""}`).join(", ") : "—"}</Td>
              <Td className="text-right"><Link className="text-sm font-medium text-primary hover:underline" href={`/admin/organisations/${o.id}/ai`}>Manage</Link></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
