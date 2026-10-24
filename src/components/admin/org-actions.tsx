"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { ConfirmButton } from "../confirm";
import { Input, Field } from "../ui/form";
import { Button } from "../ui/button";

export function OrgActions({ id, status, verification }: { id: string; status: string; verification: string }) {
  const act = useAction((action: string, reason: string) => api(`/platform/organisations/${id}/actions`, { body: { action, reason, confirm: true } }), { success: "Done" });
  return (
    <div className="flex flex-wrap gap-2">
      {status === "ACTIVE" && <ConfirmButton label="Suspend" title="Suspend organisation?" description="All members lose access immediately. Data is retained." requireReason onConfirm={(r) => act.run("suspend", r)} />}
      {status === "SUSPENDED" && <ConfirmButton variant="primary" label="Reactivate" title="Reactivate organisation?" requireReason onConfirm={(r) => act.run("reactivate", r)} />}
      {verification !== "VERIFIED" && <ConfirmButton variant="secondary" label="Mark verified" title="Verify organisation identity?" description="Record how identity was confirmed (e.g. registry check, signed contract)." requireReason onConfirm={(r) => act.run("verify", r)} />}
      {verification !== "REJECTED" && verification !== "VERIFIED" && <ConfirmButton variant="secondary" label="Reject verification" title="Reject verification?" requireReason onConfirm={(r) => act.run("reject_verification", r)} />}
    </div>
  );
}

export function CreditAdjust({ id }: { id: string }) {
  const [delta, setDelta] = useState("");
  const [key] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const adj = useAction((reason: string) => api(`/platform/organisations/${id}/credits`, { body: { delta: Number(delta), reason, confirm: true, idempotencyKey: key } }), { success: "Credits adjusted", onSuccess: () => setDelta("") });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field id="delta" label="Adjust credits (±)"><Input className="w-32" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ""))} /></Field>
      <ConfirmButton variant="primary" label="Apply" disabled={!delta || delta === "-" || Number(delta) === 0} title={`Adjust credits by ${delta}?`} description="Financial adjustment — recorded in the immutable ledger and audit log." requireReason onConfirm={(r) => adj.run(r)} />
    </div>
  );
}

export function RequestSupportAccess({ id }: { id: string }) {
  const r = useAction((reason: string) => api(`/platform/organisations/${id}/support-access`, { body: { reason } }), { success: "Request sent to organisation owners" });
  return <ConfirmButton variant="secondary" label="Request support access" title="Request metadata-only support access" description="Owners must approve. Access expires after 24 hours and never includes candidate content." requireReason confirmLabel="Send request" onConfirm={(reason) => r.run(reason)} />;
}

export function RetryButton({ path, label }: { path: string; label: string }) {
  const r = useAction(() => api(path, { method: "POST" }), { success: "Retried" });
  return <Button size="sm" variant="secondary" loading={r.pending} onClick={() => r.run()}>{label}</Button>;
}
