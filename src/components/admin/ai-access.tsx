"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { Button } from "../ui/button";
import { Checkbox, Field, Input, Textarea } from "../ui/form";
import { Badge } from "../ui/badge";
import { Alert } from "../ui/feedback";
import { FREE_TIER_LABEL, providerLabel } from "@/lib/ai-labels";

type Grant = { provider: string; capability: string; enabled: boolean; allowedModels: string[]; monthlyRequestLimit: number | null; monthlyTokenLimit: number | null; usedThisMonth: { requests: number; tokens: number } };
type Cap = { capability: string; label: string; description: string; providers: string[] };
type Model = { id: string; provider: string; label: string; freeTier: string };
type Deployment = { defaultProvider: string | null; llm: { provider: string; configured: boolean; defaultModel: string }[]; transcription: string | null; speechSynthesis: string | null };
type Row = { enabled: boolean; allowedModels: string[]; monthlyRequestLimit: string; monthlyTokenLimit: string };

const key = (c: string, p: string) => `${c}:${p}`;

/**
 * Grant / revoke platform-funded AI per capability and provider. The server enforces
 * platform.ai.manage (super-admin, MFA); this editor is read-only for everyone else.
 */
export function AiGrantEditor({ endpoint, capabilities, grants, catalog, deployment, canManage }: { endpoint: string; capabilities: Cap[]; grants: Grant[]; catalog: Model[]; deployment: Deployment; canManage: boolean }) {
  const initial: Record<string, Row> = {};
  for (const c of capabilities)
    for (const p of c.providers) {
      const g = grants.find((x) => x.capability === c.capability && x.provider === p);
      initial[key(c.capability, p)] = { enabled: !!g?.enabled, allowedModels: g?.allowedModels ?? [], monthlyRequestLimit: g?.monthlyRequestLimit?.toString() ?? "", monthlyTokenLimit: g?.monthlyTokenLimit?.toString() ?? "" };
    }
  const [rows, setRows] = useState(initial);
  const [reason, setReason] = useState("");
  const set = (k: string, patch: Partial<Row>) => setRows({ ...rows, [k]: { ...rows[k], ...patch } });
  const changed = Object.keys(rows).filter((k) => JSON.stringify(rows[k]) !== JSON.stringify(initial[k]));
  const save = useAction(
    () =>
      api(endpoint, {
        method: "PUT",
        body: {
          reason,
          grants: changed.map((k) => {
            const [capability, provider] = k.split(":");
            const r = rows[k];
            return { capability, provider, enabled: r.enabled, allowedModels: r.allowedModels, monthlyRequestLimit: r.monthlyRequestLimit === "" ? null : Number(r.monthlyRequestLimit), monthlyTokenLimit: r.monthlyTokenLimit === "" ? null : Number(r.monthlyTokenLimit) };
          }),
        },
      }),
    { success: "AI access updated", onSuccess: () => setReason("") },
  );
  const configured = (p: string, cap: string) => (cap === "TRANSCRIPTION" ? deployment.transcription === p : cap === "SPEECH_SYNTHESIS" ? deployment.speechSynthesis === p : !!deployment.llm.find((x) => x.provider === p)?.configured);

  return (
    <div className="space-y-4">
      {!canManage && <Alert tone="info">Read-only: only platform super-admins can change platform-funded AI access.</Alert>}
      {capabilities.map((c) => (
        <fieldset key={c.capability} className="rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold">{c.label}</legend>
          <p className="mb-3 text-xs text-subtle">{c.description}</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {c.providers.map((p) => {
              const k = key(c.capability, p);
              const r = rows[k];
              const g = grants.find((x) => x.capability === c.capability && x.provider === p);
              const models = catalog.filter((m) => m.provider === p);
              const text = !["TRANSCRIPTION", "SPEECH_SYNTHESIS"].includes(c.capability);
              return (
                <div key={k} className="rounded border border-border p-3" data-testid={`grant-${k}`}>
                  <div className="flex items-center justify-between gap-2">
                    <Checkbox id={`g-${k}`} disabled={!canManage} checked={r.enabled} onChange={(e) => set(k, { enabled: e.target.checked })} label={`Allow platform ${providerLabel(p)}`} />
                    {configured(p, c.capability) ? <Badge tone="success">credential configured</Badge> : <Badge tone="warning">no platform credential</Badge>}
                  </div>
                  {g && <p className="mt-1 text-xs text-subtle">This month: {g.usedThisMonth.requests} requests · {g.usedThisMonth.tokens.toLocaleString()} tokens</p>}
                  {r.enabled && (
                    <div className="mt-3 space-y-3">
                      {text && models.length > 0 && (
                        <div>
                          <p className="text-xs font-medium">Allowed models <span className="font-normal text-subtle">(none ticked = deployment default only)</span></p>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                            {models.map((m) => (
                              <Checkbox key={m.id} id={`m-${k}-${m.id}`} disabled={!canManage} checked={r.allowedModels.includes(m.id)} onChange={(e) => set(k, { allowedModels: e.target.checked ? [...r.allowedModels, m.id] : r.allowedModels.filter((x) => x !== m.id) })} label={`${m.label}`} description={FREE_TIER_LABEL[m.freeTier]} />
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field id={`rl-${k}`} label="Monthly request limit" hint="Blank = unlimited"><Input disabled={!canManage} inputMode="numeric" value={r.monthlyRequestLimit} onChange={(e) => set(k, { monthlyRequestLimit: e.target.value.replace(/\D/g, "") })} /></Field>
                        {text && <Field id={`tl-${k}`} label="Monthly token limit" hint="Blank = unlimited"><Input disabled={!canManage} inputMode="numeric" value={r.monthlyTokenLimit} onChange={(e) => set(k, { monthlyTokenLimit: e.target.value.replace(/\D/g, "") })} /></Field>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      {canManage && (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <Field id="ai-reason" label="Reason for this change" hint="Recorded in the audit log with the before/after values." required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Button disabled={!changed.length || reason.trim().length < 5} loading={save.pending} onClick={() => save.run()}>Save {changed.length ? `${changed.length} change${changed.length > 1 ? "s" : ""}` : "changes"}</Button>
        </div>
      )}
    </div>
  );
}
