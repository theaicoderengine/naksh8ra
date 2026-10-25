import { requirePlatformPage } from "@/server/auth/page";
import { providerHealth, listJobRuns, listPaymentEvents } from "@/server/services/platform";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { RetryButton } from "@/components/admin/org-actions";
import { fmtDateTime } from "@/lib/format";

function Ok({ ok, label }: { ok: boolean | null; label?: string }) {
  return ok == null ? <Badge>not configured</Badge> : ok ? <Badge tone="success">{label ?? "ok"}</Badge> : <Badge tone="danger">{label ?? "down"}</Badge>;
}

export default async function Health() {
  await requirePlatformPage("platform.ops.view");
  const [h, failedJobs, failedPayments] = await Promise.all([providerHealth(), listJobRuns("FAILED"), listPaymentEvents("FAILED")]);
  return (
    <>
      <PageHeader title="Operations" description="Infrastructure and provider status, failed background jobs and payment events." />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card><CardHeader title="Core" /><CardBody className="space-y-2 text-sm"><p>Database <Ok ok={h.database.ok} /></p><p>Redis <Ok ok={h.redis.configured ? h.redis.ok : null} /></p><p>Queue mode <Badge>{h.queue.mode}</Badge> {h.queue.staleQueued > 0 && <Badge tone="warning">{h.queue.staleQueued} stale queued</Badge>}</p><p>Storage <Badge>{h.storage.provider}</Badge></p><p>Malware scanner <Badge tone={h.malwareScanner.provider === "none" ? "warning" : "success"}>{h.malwareScanner.provider}</Badge></p></CardBody></Card>
        <Card><CardHeader title="AI providers" /><CardBody className="space-y-2 text-sm">
          <p className="text-xs text-subtle">Platform-owned (deployment) credentials. Organisations can use them only where a super-admin has granted access (Admin → AI access).</p>
          {h.llm.llm.filter((p) => p.provider !== "FIXTURE" || p.configured).map((p) => (
            <p key={p.provider}>{p.provider.charAt(0) + p.provider.slice(1).toLowerCase()} <Ok ok={p.configured ? true : null} label={p.configured ? p.defaultModel : undefined} />{p.provider === "FIXTURE" && <Badge tone="warning">test only</Badge>}{h.llm.defaultProvider === p.provider && <Badge>default</Badge>}</p>
          ))}
          <p>Speech-to-text <Ok ok={h.speech.stt.configured} label={h.speech.stt.configured ? h.speech.stt.provider : undefined} /></p>
          <p>Text-to-speech <Ok ok={h.speech.tts.configured} label={h.speech.tts.configured ? h.speech.tts.provider : undefined} /></p>
        </CardBody></Card>
        <Card><CardHeader title="Email & payments" /><CardBody className="space-y-2 text-sm"><p>Email provider <Badge tone={h.email.provider === "console" ? "warning" : "success"}>{h.email.provider}</Badge></p><p className="text-xs text-subtle">Last 7 days: {h.email.last7Days.map((e) => `${e.status.toLowerCase()} ${e._count._all}`).join(" · ") || "no email"}</p><p>Payments <Ok ok={h.payments.configured ? true : null} label={h.payments.provider} /> {h.payments.configured && !h.payments.webhookSecretConfigured && <Badge tone="danger">webhook secret missing</Badge>}</p></CardBody></Card>
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Failed background jobs</h2>
      <Table caption="Failed jobs"><thead><tr><Th>Job</Th><Th>Error</Th><Th>Attempts</Th><Th>When</Th><Th /></tr></thead><tbody>
        {failedJobs.length === 0 ? <tr><Td colSpan={5} className="text-subtle">No failed jobs.</Td></tr> : failedJobs.map((j) => <Tr key={j.id}><Td className="font-mono text-xs">{j.name}</Td><Td className="max-w-md truncate text-xs" title={j.error ?? ""}>{j.error}</Td><Td>{j.attempts}</Td><Td className="text-xs text-subtle">{fmtDateTime(j.createdAt)}</Td><Td><RetryButton path={`/platform/jobs/${j.id}/retry`} label="Retry" /></Td></Tr>)}
      </tbody></Table>
      <div className="mb-3 mt-8 flex items-center justify-between"><h2 className="text-lg font-semibold">Failed payment events</h2>{failedPayments.length > 0 && <RetryButton path="/platform/payment-events" label="Retry all" />}</div>
      <Table caption="Payment events"><thead><tr><Th>Event</Th><Th>Type</Th><Th>Status</Th><Th>Error</Th><Th>Received</Th></tr></thead><tbody>
        {failedPayments.length === 0 ? <tr><Td colSpan={5} className="text-subtle">No failed payment events.</Td></tr> : failedPayments.map((p) => <Tr key={p.id}><Td className="font-mono text-xs">{p.providerEventId}</Td><Td className="text-xs">{p.type}</Td><Td><StatusBadge status={p.status} /></Td><Td className="max-w-md truncate text-xs">{p.error}</Td><Td className="text-xs text-subtle">{fmtDateTime(p.receivedAt)}</Td></Tr>)}
      </tbody></Table>
    </>
  );
}
