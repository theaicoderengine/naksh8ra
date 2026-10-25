"use client";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "./org-context";
import { Button } from "../ui/button";
import { Field, Input, Select } from "../ui/form";
import { Badge } from "../ui/badge";
import { Alert } from "../ui/feedback";
import { Table, Th, Td, Tr } from "../ui/table";
import { ConfirmButton } from "../confirm";
import { fmtDateTime } from "@/lib/format";
import { FREE_TIER_LABEL, providerLabel } from "@/lib/ai-labels";

type Model = { id: string; provider: string; label: string; freeTier: "ELIGIBLE" | "PAID_ONLY" | "UNKNOWN"; notes?: string };
type Credential = { provider: string; maskedKey: string; fingerprint: string; model: string; status: "ACTIVE" | "INVALID"; version: number; lastValidatedAt: string | null; lastError: string | null; lastErrorAt: string | null; connectedAt: string; updatedAt: string };
type Effective = { available: true; resolution: { provider: string; model: string | null; source: "ORGANISATION" | "PLATFORM"; mode: string } | null } | { available: false; code: string; message: string };
type Grant = { provider: string; allowedModels: string[]; monthlyRequestLimit: number | null; monthlyTokenLimit: number | null; usedThisMonth: { requests: number; tokens: number }; platformCredentialConfigured: boolean };
type Capability = { capability: string; label: string; description: string; byok: boolean; route: { source: string; provider: string; model: string | null } | null; effective: Effective; platformGrants: Grant[] };
type Usage = { capability: string; provider: string | null; source: string | null; status: string; requests: number; inputTokens: number; outputTokens: number; estimatedCostMicros: number | null };
type ErrorRow = { id: string; capability: string; provider: string | null; source: string | null; status: string; errorCode: string | null; createdAt: string };
export type AiSettingsData = {
  organisation: { id: string; name: string };
  providers: { provider: string; label: string; credential: Credential | null }[];
  models: Model[];
  capabilities: Capability[];
  usage: Usage[];
  recentErrors: ErrorRow[];
};

const sourceLabel = (s: string | null | undefined) => (s === "ORGANISATION" ? "Your key" : s === "PLATFORM" ? "Platform (authorised)" : "—");

function EffectiveBadge({ e }: { e: Effective }) {
  if (!e.available) return <span className="text-xs text-danger">{e.message}</span>;
  if (!e.resolution) return <Badge>Browser voice (no provider)</Badge>;
  const r = e.resolution;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge tone={r.source === "ORGANISATION" ? "success" : "neutral"}>{sourceLabel(r.source)}</Badge>
      <span className="text-sm">{providerLabel(r.provider)}{r.model ? ` · ${r.model}` : ""}</span>
      {r.mode === "FIXTURE" && <Badge tone="warning">fixture</Badge>}
    </span>
  );
}

function ProviderCard({ p, models }: { p: AiSettingsData["providers"][number]; models: Model[] }) {
  const org = useOrg();
  const own = models.filter((m) => m.provider === p.provider);
  const c = p.credential;
  const [editing, setEditing] = useState(!c);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(c?.model ?? own[0]?.id ?? "");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const selected = own.find((m) => m.id === model);
  const base = `/ai/credentials/${p.provider}`;

  const test = useAction(() => api<{ ok: boolean; message: string }>(`${base}/test-key`, { org: org.slug, body: { apiKey, model } }), { refresh: false, onSuccess: (r) => setTestResult(r) });
  const save = useAction(() => api(base, { method: "PUT", org: org.slug, body: { ...(apiKey ? { apiKey } : {}), model } }), {
    success: c ? "Provider connection updated" : "Provider connected",
    onSuccess: () => {
      setApiKey("");
      setTestResult(null);
      setEditing(false);
    },
  });
  const retest = useAction(() => api<{ test: { ok: boolean; message: string } }>(`${base}/test`, { org: org.slug, body: {} }), { success: (r) => (r.test.ok ? "Connection OK" : "Connection test failed"), onSuccess: (r) => setTestResult(r.test) });
  const remove = useAction(() => api(base, { method: "DELETE", org: org.slug }), { success: "Key removed" });

  return (
    <div className="rounded-lg border border-border p-4" data-testid={`provider-${p.provider}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{p.label}</h3>
          {c ? (
            <p className="mt-1 text-sm text-subtle">
              Key <span className="font-mono">{c.maskedKey}</span> · {c.model} · v{c.version}
              {c.lastValidatedAt && <> · validated {fmtDateTime(c.lastValidatedAt)}</>}
            </p>
          ) : (
            <p className="mt-1 text-sm text-subtle">Not connected</p>
          )}
        </div>
        {c && <Badge tone={c.status === "ACTIVE" ? "success" : "danger"}>{c.status === "ACTIVE" ? "Active" : "Invalid"}</Badge>}
      </div>
      {c?.lastError && <p className="mt-2 text-xs text-danger">Last error{c.lastErrorAt ? ` (${fmtDateTime(c.lastErrorAt)})` : ""}: {c.lastError}</p>}
      {p.provider === "GEMINI" && (
        <Alert tone="info" className="mt-3">
          Google&apos;s free and paid tiers differ in quotas, availability, billing status and data-use terms (on the free tier, prompts may be used to improve Google&apos;s products). Free-tier eligibility shown here is informational and can change; when a quota is reached, requests fail with a clear message and are never moved to a paid model automatically.
        </Alert>
      )}
      {editing ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id={`key-${p.provider}`} label={c ? "New API key (leave blank to keep the current key)" : "API key"} hint="Stored encrypted. It is never shown again — only the last 4 characters.">
            <Input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }} />
          </Field>
          <Field id={`model-${p.provider}`} label="Model" hint={selected ? (selected.notes ?? FREE_TIER_LABEL[selected.freeTier]) : undefined}>
            <Select value={model} onChange={(e) => { setModel(e.target.value); setTestResult(null); }}>
              {own.map((m) => <option key={m.id} value={m.id}>{m.label} ({FREE_TIER_LABEL[m.freeTier]})</option>)}
            </Select>
          </Field>
          {testResult && <Alert className="sm:col-span-2" tone={testResult.ok ? "success" : "danger"}>{testResult.message}</Alert>}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button variant="secondary" disabled={!apiKey} loading={test.pending} onClick={() => test.run()}>Test connection</Button>
            <Button disabled={!c && !apiKey} loading={save.pending} onClick={() => save.run()}>{c ? "Test & save" : "Test & activate"}</Button>
            {c && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={retest.pending} onClick={() => retest.run()}>Re-test</Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Replace key or change model</Button>
          <ConfirmButton label="Remove" title={`Remove the ${p.label} key?`} description="Capabilities explicitly set to use this key will stop working until you choose another provider. Nothing switches to platform AI automatically." onConfirm={() => remove.run()} />
          {testResult && <span className={testResult.ok ? "text-sm text-success" : "text-sm text-danger"}>{testResult.message}</span>}
        </div>
      )}
    </div>
  );
}

function RoutesEditor({ data }: { data: AiSettingsData }) {
  const org = useOrg();
  const connected = data.providers.filter((p) => p.credential);
  const text = data.capabilities.filter((c) => c.byok);
  const initial = useMemo(() => Object.fromEntries(text.map((c) => [c.capability, c.route ? `${c.route.source}:${c.route.provider}:${c.route.model ?? ""}` : "AUTO"])), [text]);
  const [v, setV] = useState<Record<string, string>>(initial);
  const save = useAction(
    () =>
      api("/ai/routes", {
        method: "PUT",
        org: org.slug,
        body: {
          routes: text.map((c) => {
            const [source, provider, model] = (v[c.capability] ?? "AUTO").split(":");
            return source === "AUTO" ? { capability: c.capability, source } : { capability: c.capability, source, provider, model: model || null };
          }),
        },
      }),
    { success: "Provider selection saved" },
  );
  return (
    <div className="space-y-3">
      <Table caption="Provider per AI capability">
        <thead><tr><Th>Capability</Th><Th>Currently used</Th><Th>Use</Th></tr></thead>
        <tbody>
          {data.capabilities.map((c) => (
            <Tr key={c.capability}>
              <Td><div className="font-medium">{c.label}</div><div className="text-xs text-subtle">{c.description}</div></Td>
              <Td><EffectiveBadge e={c.effective} /></Td>
              <Td>
                {c.byok ? (
                  <Select aria-label={`Provider for ${c.label}`} value={v[c.capability]} onChange={(e) => setV({ ...v, [c.capability]: e.target.value })}>
                    <option value="AUTO">Automatic</option>
                    {connected.map((p) => <option key={p.provider} value={`ORGANISATION:${p.provider}:`}>Your {p.label} key</option>)}
                    {c.platformGrants.flatMap((g) =>
                      g.allowedModels.length > 1
                        ? g.allowedModels.map((m) => <option key={`${g.provider}:${m}`} value={`PLATFORM:${g.provider}:${m}`}>Platform {providerLabel(g.provider)} · {m}</option>)
                        : [<option key={g.provider} value={`PLATFORM:${g.provider}:`}>Platform {providerLabel(g.provider)}</option>],
                    )}
                  </Select>
                ) : (
                  <span className="text-xs text-subtle">Platform speech service only — your text-generation keys do not enable speech.</span>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Button loading={save.pending} onClick={() => save.run()}>Save selection</Button>
    </div>
  );
}

export function AiProvidersSettings({ data }: { data: AiSettingsData }) {
  const grants = data.capabilities.flatMap((c) => c.platformGrants.map((g) => ({ ...g, capability: c.label })));
  return (
    <div className="space-y-8">
      <Alert tone="info" title="How AI providers are chosen">
        Each AI operation uses, in order: the provider you select below; otherwise your own connected key; otherwise platform-funded AI, but only where the platform administrator has authorised it for this organisation. If none applies, the operation stops with a clear message — nothing is simulated and nothing switches provider silently. Keys are stored encrypted and used only on our servers.
      </Alert>

      <section aria-labelledby="keys-h">
        <h2 id="keys-h" className="mb-3 text-base font-semibold">Your provider keys</h2>
        <div className="grid gap-4 lg:grid-cols-2">{data.providers.map((p) => <ProviderCard key={p.provider} p={p} models={data.models} />)}</div>
      </section>

      <section aria-labelledby="routes-h">
        <h2 id="routes-h" className="mb-1 text-base font-semibold">Provider for each capability</h2>
        <p className="mb-3 text-sm text-subtle">Automatic uses your connected key if you have one, otherwise platform AI where authorised.</p>
        <RoutesEditor data={data} />
      </section>

      <section aria-labelledby="grants-h">
        <h2 id="grants-h" className="mb-1 text-base font-semibold">Platform AI authorised for this organisation</h2>
        <p className="mb-3 text-sm text-subtle">Set by the platform administrator. You can use these, but you cannot enable or extend them yourself.</p>
        {grants.length === 0 ? (
          <p className="text-sm text-subtle">None. Connect your own key above, or contact the platform administrator.</p>
        ) : (
          <Table caption="Platform AI grants">
            <thead><tr><Th>Capability</Th><Th>Provider</Th><Th>Models</Th><Th>This month</Th></tr></thead>
            <tbody>
              {grants.map((g) => (
                <Tr key={`${g.capability}:${g.provider}`}>
                  <Td>{g.capability}</Td>
                  <Td>{providerLabel(g.provider)}{!g.platformCredentialConfigured && <Badge tone="warning" className="ml-1">not configured</Badge>}</Td>
                  <Td className="text-xs">{g.allowedModels.length ? g.allowedModels.join(", ") : "Platform default"}</Td>
                  <Td className="text-xs">{g.usedThisMonth.requests}{g.monthlyRequestLimit != null ? ` / ${g.monthlyRequestLimit}` : ""} requests · {g.usedThisMonth.tokens.toLocaleString()}{g.monthlyTokenLimit != null ? ` / ${g.monthlyTokenLimit.toLocaleString()}` : ""} tokens</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="usage-h">
        <h2 id="usage-h" className="mb-1 text-base font-semibold">Usage (last 30 days)</h2>
        <p className="mb-3 text-sm text-subtle">Cost is an internal estimate from configured prices where available — not your provider&apos;s bill. Check your provider dashboard for actual charges on your own keys.</p>
        <Table caption="AI usage">
          <thead><tr><Th>Capability</Th><Th>Provider</Th><Th>Source</Th><Th>Outcome</Th><Th className="text-right">Requests</Th><Th className="text-right">Tokens (in / out)</Th><Th className="text-right">Est. cost</Th></tr></thead>
          <tbody>
            {data.usage.length === 0 ? <tr><Td colSpan={7} className="text-subtle">No AI requests yet.</Td></tr> : data.usage.map((u, i) => (
              <Tr key={i}>
                <Td className="text-xs">{u.capability.replace(/_/g, " ").toLowerCase()}</Td>
                <Td className="text-xs">{providerLabel(u.provider)}</Td>
                <Td className="text-xs">{sourceLabel(u.source)}</Td>
                <Td><Badge tone={u.status === "SUCCEEDED" ? "success" : u.status === "DENIED" ? "warning" : "danger"}>{u.status.toLowerCase()}</Badge></Td>
                <Td className="text-right tabular-nums">{u.requests}</Td>
                <Td className="text-right text-xs tabular-nums">{u.inputTokens.toLocaleString()} / {u.outputTokens.toLocaleString()}</Td>
                <Td className="text-right text-xs tabular-nums">{u.estimatedCostMicros != null ? `~$${(u.estimatedCostMicros / 1_000_000).toFixed(4)}` : "n/a"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section aria-labelledby="errors-h">
        <h2 id="errors-h" className="mb-3 text-base font-semibold">Recent provider errors and denials</h2>
        <Table caption="Recent AI errors">
          <thead><tr><Th>When</Th><Th>Capability</Th><Th>Provider</Th><Th>Source</Th><Th>Error</Th></tr></thead>
          <tbody>
            {data.recentErrors.length === 0 ? <tr><Td colSpan={5} className="text-subtle">None.</Td></tr> : data.recentErrors.map((e) => (
              <Tr key={e.id}>
                <Td className="text-xs text-subtle">{fmtDateTime(e.createdAt)}</Td>
                <Td className="text-xs">{e.capability.replace(/_/g, " ").toLowerCase()}</Td>
                <Td className="text-xs">{providerLabel(e.provider)}</Td>
                <Td className="text-xs">{sourceLabel(e.source)}</Td>
                <Td className="font-mono text-xs">{e.errorCode ?? e.status}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
