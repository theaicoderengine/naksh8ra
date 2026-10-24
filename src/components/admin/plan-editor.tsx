"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input, Select, Textarea, Checkbox } from "../ui/form";
import { Alert } from "../ui/feedback";

type PlanV = { key: string; name: string; description: string; audience: string; interval: string; priceAmount: string; currency: string; stripePriceId: string; trialDays: string; isPublic: boolean; isActive: boolean; sortOrder: string; entitlements: string };
export const emptyPlan: PlanV = { key: "", name: "", description: "", audience: "EMPLOYER", interval: "MONTH", priceAmount: "0", currency: "usd", stripePriceId: "", trialDays: "0", isPublic: true, isActive: true, sortOrder: "0", entitlements: "seats=5\nmonthly_interview_credits=20\nfeature.realtime_interviews=true" };

export function PlanEditor({ initial, label }: { initial: PlanV; label: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const save = useAction(() => api("/platform/plans", { body: { ...v, description: v.description || null, stripePriceId: v.stripePriceId || null, priceAmount: Number(v.priceAmount), trialDays: Number(v.trialDays), sortOrder: Number(v.sortOrder), entitlements: Object.fromEntries(v.entitlements.split("\n").map((l) => l.split("=").map((x) => x.trim())).filter((x) => x.length === 2 && x[0])) } }), { success: "Plan saved", onSuccess: () => setOpen(false) });
  return (<>
    <Button size="sm" variant={initial.key ? "secondary" : "primary"} onClick={() => setOpen(true)}>{label}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title={initial.key ? `Edit ${initial.name}` : "New plan"} size="lg" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={save.pending} onClick={() => save.run()}>Save plan</Button></>}>
      <div className="space-y-3">
        {save.error && <Alert tone="danger">{save.error.message}</Alert>}
        <Alert tone="warning">Prices are stored in minor units (e.g. cents). The amount charged is the Stripe Price — keep them in sync. Existing subscribers are not repriced automatically.</Alert>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="pk" label="Key"><Input disabled={!!initial.key} value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} /></Field>
          <Field id="pn" label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field id="pa" label="Audience"><Select value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value })}><option>EMPLOYER</option><option>UNIVERSITY</option><option>STUDENT</option></Select></Field>
          <Field id="pi" label="Interval"><Select value={v.interval} onChange={(e) => setV({ ...v, interval: e.target.value })}><option>MONTH</option><option>YEAR</option></Select></Field>
          <Field id="pp" label="Price (minor units)"><Input inputMode="numeric" value={v.priceAmount} onChange={(e) => setV({ ...v, priceAmount: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field id="pc" label="Currency"><Input maxLength={3} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toLowerCase() })} /></Field>
          <Field id="ps" label="Stripe price ID"><Input value={v.stripePriceId} onChange={(e) => setV({ ...v, stripePriceId: e.target.value })} /></Field>
          <Field id="pt" label="Trial days"><Input inputMode="numeric" value={v.trialDays} onChange={(e) => setV({ ...v, trialDays: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field id="po" label="Sort order"><Input inputMode="numeric" value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value.replace(/\D/g, "") })} /></Field>
        </div>
        <Field id="pd" label="Description"><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field id="pe" label="Entitlements" hint="key=value per line: seats, monthly_interview_credits, trial_interview_credits, feature.*"><Textarea rows={5} className="font-mono text-xs" value={v.entitlements} onChange={(e) => setV({ ...v, entitlements: e.target.value })} /></Field>
        <div className="flex gap-6"><Checkbox id="pub" checked={v.isPublic} onChange={(e) => setV({ ...v, isPublic: e.target.checked })} label="Public" /><Checkbox id="act" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} label="Active" /></div>
      </div>
    </Dialog>
  </>);
}

type PackV = { key: string; name: string; credits: string; priceAmount: string; currency: string; stripePriceId: string; audience: string; expiresInDays: string; isActive: boolean };
export const emptyPack: PackV = { key: "", name: "", credits: "10", priceAmount: "0", currency: "usd", stripePriceId: "", audience: "EMPLOYER", expiresInDays: "365", isActive: true };

export function PackEditor({ initial, label }: { initial: PackV; label: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const save = useAction(() => api("/platform/credit-packs", { body: { ...v, credits: Number(v.credits), priceAmount: Number(v.priceAmount), stripePriceId: v.stripePriceId || null, expiresInDays: v.expiresInDays ? Number(v.expiresInDays) : null } }), { success: "Pack saved", onSuccess: () => setOpen(false) });
  return (<>
    <Button size="sm" variant={initial.key ? "secondary" : "primary"} onClick={() => setOpen(true)}>{label}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title={initial.key ? `Edit ${initial.name}` : "New credit pack"} footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={save.pending} onClick={() => save.run()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="kk" label="Key"><Input disabled={!!initial.key} value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} /></Field>
        <Field id="kn" label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field id="kc" label="Credits"><Input inputMode="numeric" value={v.credits} onChange={(e) => setV({ ...v, credits: e.target.value.replace(/\D/g, "") })} /></Field>
        <Field id="ka" label="Audience"><Select value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value })}><option>EMPLOYER</option><option>STUDENT</option></Select></Field>
        <Field id="kp" label="Price (minor units)"><Input inputMode="numeric" value={v.priceAmount} onChange={(e) => setV({ ...v, priceAmount: e.target.value.replace(/\D/g, "") })} /></Field>
        <Field id="kcur" label="Currency"><Input maxLength={3} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toLowerCase() })} /></Field>
        <Field id="ks" label="Stripe price ID"><Input value={v.stripePriceId} onChange={(e) => setV({ ...v, stripePriceId: e.target.value })} /></Field>
        <Field id="ke" label="Expires after (days)" hint="Blank = never; disclosed to buyers"><Input inputMode="numeric" value={v.expiresInDays} onChange={(e) => setV({ ...v, expiresInDays: e.target.value.replace(/\D/g, "") })} /></Field>
        <Checkbox id="kact" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} label="Active" />
      </div>
    </Dialog>
  </>);
}
