"use client";
import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { password as pwSchema } from "@/lib/schemas";
import { Field, Input } from "../ui/form";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";

export function ResetForm({ token }: { token: string }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = pwSchema.safeParse(pw);
  if (done) return <Alert tone="success" title="Password updated">All other sessions were signed out. <Link className="font-medium text-primary hover:underline" href="/login">Sign in</Link></Alert>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!check.success || pw !== pw2) return;
        setBusy(true);
        setErr(null);
        try {
          await api("/auth/password/reset", { body: { token, password: pw } });
          setDone(true);
        } catch (e) {
          setErr(e instanceof ApiError ? e.message : "Reset failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {err && <Alert tone="danger">{err}</Alert>}
      <Field id="pw" label="New password" error={pw && !check.success ? check.error.issues[0].message : undefined}><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field id="pw2" label="Confirm password" error={pw2 && pw !== pw2 ? "Passwords don't match" : undefined}><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      <Button type="submit" className="w-full" loading={busy} disabled={!check.success || pw !== pw2}>Update password</Button>
    </form>
  );
}
