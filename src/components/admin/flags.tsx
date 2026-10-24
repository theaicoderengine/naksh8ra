"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { Button } from "../ui/button";
import { Input, Field, Textarea } from "../ui/form";
import { Badge } from "../ui/badge";

export function Flags({ flags }: { flags: { key: string; description: string | null; enabled: boolean; rules: { organisationIds?: string[] } }[] }) {
  const [nk, setNk] = useState("");
  const save = useAction((key: string, enabled: boolean, description: string | null, orgs: string[]) => api("/platform/flags", { body: { key, enabled, description, rules: { organisationIds: orgs } } }), { success: "Flag saved" });
  return (
    <div className="space-y-3">
      {flags.map((f) => (
        <div key={f.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
          <div><p className="font-mono">{f.key}</p><p className="text-xs text-subtle">{f.description}{f.rules?.organisationIds?.length ? ` · enabled for ${f.rules.organisationIds.length} org(s)` : ""}</p></div>
          <div className="flex items-center gap-2"><Badge tone={f.enabled ? "success" : "neutral"}>{f.enabled ? "on for everyone" : "off"}</Badge><Button size="sm" variant="secondary" onClick={() => save.run(f.key, !f.enabled, f.description, f.rules?.organisationIds ?? [])}>{f.enabled ? "Turn off" : "Turn on"}</Button></div>
        </div>
      ))}
      <div className="flex gap-2"><Input aria-label="New flag key" placeholder="new.flag-key" className="w-64" value={nk} onChange={(e) => setNk(e.target.value)} /><Button size="sm" disabled={nk.length < 2} onClick={() => { save.run(nk, false, null, []); setNk(""); }}>Add flag</Button></div>
    </div>
  );
}

export function Settings({ practiceFree, announcement }: { practiceFree: number; announcement: string }) {
  const [p, setP] = useState(String(practiceFree));
  const [a, setA] = useState(announcement);
  const save = useAction((key: string, value: unknown) => api("/platform/settings", { body: { key, value } }), { success: "Setting saved" });
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2"><Field id="pf" label="Free practice sessions per student per month"><Input className="w-32" inputMode="numeric" value={p} onChange={(e) => setP(e.target.value.replace(/\D/g, ""))} /></Field><Button size="sm" onClick={() => save.run("practice.freeMonthly", Number(p))}>Save</Button></div>
      <div className="space-y-2"><Field id="an" label="Platform announcement (internal)"><Textarea rows={2} value={a} onChange={(e) => setA(e.target.value)} /></Field><Button size="sm" onClick={() => save.run("platform.announcement", a)}>Save</Button></div>
    </div>
  );
}
