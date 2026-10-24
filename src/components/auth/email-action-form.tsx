"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Field, Input } from "../ui/form";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";

/** Shared form for "resend verification" and "forgot password" — responses are identical whether or not the account exists. */
export function EmailActionForm({ endpoint, cta, defaultEmail }: { endpoint: string; cta: string; defaultEmail?: string }) {
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [msg, setMsg] = useState<string | null>(null);
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
          const r = await api<{ message: string }>(endpoint, { body: { email } });
          setMsg(r.message);
        } catch (e) {
          setErr(e instanceof ApiError ? e.message : "Request failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {msg && <Alert tone="success">{msg}</Alert>}
      {err && <Alert tone="danger">{err}</Alert>}
      <Field id="email" label="Email"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Button type="submit" className="w-full" loading={busy}>{cta}</Button>
    </form>
  );
}
