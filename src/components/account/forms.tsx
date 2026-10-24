"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { password as pwSchema } from "@/lib/schemas";
import { useAction } from "../use-action";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/form";
import { Alert } from "../ui/feedback";
import { Table, Th, Td, Tr } from "../ui/table";
import { Badge } from "../ui/badge";
import { fmtDateTime, fmtRelative } from "@/lib/format";

export function NameForm({ first, last }: { first: string; last: string }) {
  const [v, setV] = useState({ firstName: first, lastName: last });
  const save = useAction(() => api("/auth/profile", { method: "PATCH", body: v }), { success: "Saved" });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2"><Field id="fn" label="First name"><Input value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} /></Field><Field id="ln" label="Last name"><Input value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} /></Field></div>
      <Button size="sm" loading={save.pending} onClick={() => save.run()}>Save</Button>
    </div>
  );
}

export function PasswordForm() {
  const [v, setV] = useState({ currentPassword: "", newPassword: "" });
  const check = pwSchema.safeParse(v.newPassword);
  const save = useAction(() => api("/auth/password/change", { body: v }), { success: "Password changed — other sessions signed out", onSuccess: () => setV({ currentPassword: "", newPassword: "" }) });
  return (
    <div className="space-y-3">
      <Field id="cur" label="Current password"><Input type="password" autoComplete="current-password" value={v.currentPassword} onChange={(e) => setV({ ...v, currentPassword: e.target.value })} /></Field>
      <Field id="new" label="New password" error={v.newPassword && !check.success ? check.error.issues[0].message : undefined}><Input type="password" autoComplete="new-password" value={v.newPassword} onChange={(e) => setV({ ...v, newPassword: e.target.value })} /></Field>
      <Button size="sm" loading={save.pending} disabled={!check.success || !v.currentPassword} onClick={() => save.run()}>Change password</Button>
    </div>
  );
}

export function MfaSetup({ enabled, required }: { enabled: boolean; required: boolean }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const begin = useAction(() => api<{ secret: string; otpauthUrl: string }>("/auth/mfa/setup", { method: "POST" }), { refresh: false, onSuccess: setSetup });
  const confirm = useAction(() => api("/auth/mfa/enable", { body: { code } }), { success: "Two-factor authentication enabled", onSuccess: () => setSetup(null) });
  const disable = useAction(() => api("/auth/mfa/disable", { body: { password: pw, code } }), { success: "Two-factor authentication disabled" });
  useEffect(() => {
    if (setup) QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 180 }).then(setQr).catch(() => setQr(null));
  }, [setup]);
  if (enabled)
    return (
      <div className="space-y-3">
        <p className="text-sm"><Badge tone="success">Enabled</Badge> Your account is protected with an authenticator app.</p>
        <details><summary className="cursor-pointer text-sm text-subtle">Disable two-factor authentication</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3"><Input type="password" aria-label="Password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} /><Input aria-label="Code" inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /><Button variant="danger" size="sm" loading={disable.pending} onClick={() => disable.run()}>Disable</Button></div>
        </details>
      </div>
    );
  return (
    <div className="space-y-3">
      {required && <Alert tone="warning" title="Two-factor authentication required">Your role or organisation requires MFA before you can continue.</Alert>}
      {!setup ? <Button size="sm" loading={begin.pending} onClick={() => begin.run()}>Set up authenticator app</Button> : (
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          {qr ? <img src={qr} alt="QR code for your authenticator app" className="h-[180px] w-[180px] rounded border border-border bg-white p-1" /> : <div />}
          <div className="space-y-3 text-sm">
            <p>Scan the QR code with an authenticator app (e.g. 1Password, Google Authenticator, Microsoft Authenticator), or enter this key:</p>
            <code className="block break-all rounded bg-muted p-2 font-mono text-xs">{setup.secret}</code>
            <div className="flex gap-2"><Input aria-label="Verification code" inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="w-40" /><Button size="sm" loading={confirm.pending} disabled={code.length !== 6} onClick={() => confirm.run()}>Verify & enable</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sessions({ items }: { items: { id: string; ipAddress: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }[] }) {
  const revoke = useAction((id: string) => api(`/auth/sessions/${id}`, { method: "DELETE" }), { success: "Session signed out" });
  return (
    <Table caption="Active sessions"><thead><tr><Th>Device</Th><Th>IP</Th><Th>Signed in</Th><Th>Last active</Th><Th /></tr></thead><tbody>
      {items.map((s) => <Tr key={s.id}><Td className="max-w-xs truncate text-xs" title={s.userAgent ?? ""}>{s.userAgent ?? "Unknown"}{s.current && <Badge tone="primary" className="ml-1">This device</Badge>}</Td><Td className="text-xs">{s.ipAddress ?? "—"}</Td><Td className="text-xs text-subtle">{fmtDateTime(s.createdAt)}</Td><Td className="text-xs text-subtle">{fmtRelative(s.lastSeenAt)}</Td><Td className="text-right">{!s.current && <Button size="sm" variant="ghost" onClick={() => revoke.run(s.id)}>Sign out</Button>}</Td></Tr>)}
    </tbody></Table>
  );
}
