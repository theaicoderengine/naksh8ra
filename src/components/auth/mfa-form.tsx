"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Field, Input } from "../ui/form";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";

export function MfaForm({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await api("/auth/mfa/verify", { body: { code } });
          window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
        } catch (e) {
          setErr(e instanceof ApiError ? e.message : "Verification failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {err && <Alert tone="danger">{err}</Alert>}
      <Field id="code" label="6-digit code" hint="From your authenticator app"><Input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
      <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>Verify</Button>
    </form>
  );
}
