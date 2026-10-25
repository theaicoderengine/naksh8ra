import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/format";
import { providerLabel } from "@/lib/ai-labels";

type Usage = { capability: string; provider: string | null; source: string | null; status: string; requests: number; inputTokens: number; outputTokens: number; estimatedCostMicros: number | null };
type Err = { id: string; capability: string; provider: string | null; source: string | null; status: string; errorCode: string | null; createdAt: Date | string };
type Hist = { id: string; action: string; actorType: string; reason: string | null; metadata: unknown; createdAt: Date | string };
type Cred = { provider: string; maskedKey: string; fingerprint: string; model: string; status: string; version: number; lastValidatedAt: Date | string | null; lastError: string | null };
type Route = { capability: string; source: string; provider: string; model: string | null };
const cap = (c: string) => c.replace(/_/g, " ").toLowerCase();

/** Read-only panels shared by the organisation and personal-accounts AI access pages. Never shows key values. */
export function AiAccessPanels({ usage, recentErrors, history, orgCredentials, routes }: { usage: Usage[]; recentErrors: Err[]; history: Hist[]; orgCredentials?: Cred[]; routes?: Route[] }) {
  return (
    <div className="mt-8 space-y-6">
      {orgCredentials && (
        <Card><CardHeader title="Organisation-owned keys" description="Health only — key values are never displayed or retrievable." /><CardBody>
          <Table caption="Organisation keys"><thead><tr><Th>Provider</Th><Th>Key</Th><Th>Model</Th><Th>Status</Th><Th>Validated</Th></tr></thead><tbody>
            {orgCredentials.length === 0 ? <tr><Td colSpan={5} className="text-subtle">None connected.</Td></tr> : orgCredentials.map((c) => (
              <Tr key={c.provider}><Td>{providerLabel(c.provider)}</Td><Td className="font-mono text-xs">{c.maskedKey} <span className="text-subtle">#{c.fingerprint}</span></Td><Td className="text-xs">{c.model} · v{c.version}</Td><Td><Badge tone={c.status === "ACTIVE" ? "success" : "danger"}>{c.status.toLowerCase()}</Badge>{c.lastError && <div className="mt-1 max-w-xs text-xs text-danger">{c.lastError}</div>}</Td><Td className="text-xs text-subtle">{c.lastValidatedAt ? fmtDateTime(c.lastValidatedAt) : "—"}</Td></Tr>
            ))}
          </tbody></Table>
          {routes && routes.length > 0 && <p className="mt-3 text-xs text-subtle">Explicit selections: {routes.map((r) => `${cap(r.capability)} → ${r.source === "ORGANISATION" ? "own" : "platform"} ${providerLabel(r.provider)}${r.model ? ` (${r.model})` : ""}`).join("; ")}</p>}
        </CardBody></Card>
      )}
      <Card><CardHeader title="Usage (30 days)" description="Estimated cost from configured prices; not provider billing." /><CardBody>
        <Table caption="AI usage"><thead><tr><Th>Capability</Th><Th>Provider</Th><Th>Source</Th><Th>Outcome</Th><Th className="text-right">Requests</Th><Th className="text-right">Tokens</Th><Th className="text-right">Est. cost</Th></tr></thead><tbody>
          {usage.length === 0 ? <tr><Td colSpan={7} className="text-subtle">No requests.</Td></tr> : usage.map((u, i) => (
            <Tr key={i}><Td className="text-xs">{cap(u.capability)}</Td><Td className="text-xs">{providerLabel(u.provider)}</Td><Td className="text-xs">{u.source?.toLowerCase() ?? "—"}</Td><Td className="text-xs">{u.status.toLowerCase()}</Td><Td className="text-right tabular-nums">{u.requests}</Td><Td className="text-right text-xs tabular-nums">{(u.inputTokens + u.outputTokens).toLocaleString()}</Td><Td className="text-right text-xs tabular-nums">{u.estimatedCostMicros != null ? `~$${(u.estimatedCostMicros / 1e6).toFixed(4)}` : "n/a"}</Td></Tr>
          ))}
        </tbody></Table>
      </CardBody></Card>
      <Card><CardHeader title="Recent errors and denials" /><CardBody>
        <Table caption="Recent AI errors"><thead><tr><Th>When</Th><Th>Capability</Th><Th>Provider</Th><Th>Source</Th><Th>Error</Th></tr></thead><tbody>
          {recentErrors.length === 0 ? <tr><Td colSpan={5} className="text-subtle">None.</Td></tr> : recentErrors.map((e) => (
            <Tr key={e.id}><Td className="text-xs text-subtle">{fmtDateTime(e.createdAt)}</Td><Td className="text-xs">{cap(e.capability)}</Td><Td className="text-xs">{providerLabel(e.provider)}</Td><Td className="text-xs">{e.source?.toLowerCase() ?? "—"}</Td><Td className="font-mono text-xs">{e.errorCode ?? e.status}</Td></Tr>
          ))}
        </tbody></Table>
      </CardBody></Card>
      <Card><CardHeader title="Audit history" description="Grants, revocations and configuration changes" /><CardBody>
        <ul className="space-y-2 text-sm">
          {history.length === 0 ? <li className="text-subtle">No changes recorded.</li> : history.map((h) => {
            const m = (h.metadata ?? {}) as { provider?: string; capability?: string; model?: string; before?: unknown; after?: unknown };
            return (
              <li key={h.id} className="border-b border-border pb-2 last:border-0">
                <span className="font-mono text-xs">{h.action}</span> <span className="text-xs text-subtle">{fmtDateTime(h.createdAt)} · {h.actorType.toLowerCase().replace(/_/g, " ")}</span>
                <div className="text-xs">{[m.capability && cap(m.capability), m.provider && providerLabel(m.provider), m.model].filter(Boolean).join(" · ")}{h.reason ? ` — “${h.reason}”` : ""}</div>
                {(m.before !== undefined || m.after !== undefined) && <div className="text-xs text-subtle">{JSON.stringify(m.before)} → {JSON.stringify(m.after)}</div>}
              </li>
            );
          })}
        </ul>
      </CardBody></Card>
    </div>
  );
}
