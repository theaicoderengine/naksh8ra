"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import Link from "next/link";
import type { z } from "zod";
import { loginForm } from "@/lib/schemas";
import { api, ApiError } from "@/lib/api";
import { Field, Input } from "../ui/form";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";

function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : null;
}

export function LoginForm({ next }: { next: string | null }) {
  const [err, setErr] = useState<string | null>(null);
  const f = useForm<z.infer<typeof loginForm>>({ resolver: zodResolver(loginForm) });
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={f.handleSubmit(async (v) => {
        setErr(null);
        try {
          const r = await api<{ mfaRequired: boolean; emailVerified: boolean; next: string }>("/auth/login", { body: v });
          const dest = safeNext(next);
          if (r.mfaRequired) window.location.href = `/login/mfa?next=${encodeURIComponent(dest ?? r.next)}`;
          else if (!r.emailVerified) window.location.href = "/verify-email/sent";
          else window.location.href = dest ?? r.next;
        } catch (e) {
          setErr(e instanceof ApiError ? e.message : "Sign-in failed");
        }
      })}
    >
      {err && <Alert tone="danger">{err}</Alert>}
      <Field id="email" label="Email" error={f.formState.errors.email?.message}><Input type="email" autoComplete="email" autoFocus {...f.register("email")} /></Field>
      <Field id="password" label="Password" error={f.formState.errors.password?.message}><Input type="password" autoComplete="current-password" {...f.register("password")} /></Field>
      <div className="flex justify-end text-sm"><Link href="/forgot-password" className="text-primary hover:underline">Forgot password?</Link></div>
      <Button type="submit" className="w-full" loading={f.formState.isSubmitting}>Sign in</Button>
    </form>
  );
}
