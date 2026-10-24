"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import Link from "next/link";
import type { z } from "zod";
import { registerForm } from "@/lib/schemas";
import { api, ApiError } from "@/lib/api";
import { Field, Input, Checkbox } from "../ui/form";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";

export function RegisterForm({ intent, askCompany, inviteEmail }: { intent: "EMPLOYER" | "STUDENT" | "UNIVERSITY" | "CANDIDATE"; askCompany?: boolean; inviteEmail?: string }) {
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const f = useForm<z.infer<typeof registerForm>>({ resolver: zodResolver(registerForm), defaultValues: { email: inviteEmail ?? "" } });
  if (done)
    return (
      <Alert tone="success" title="Check your inbox">
        We&apos;ve sent a verification link to <strong>{f.getValues("email")}</strong>. It expires in 24 hours. If an account already exists for this address, you&apos;ll receive a sign-in reminder instead.
        <div className="mt-3"><Link href="/login" className="font-medium text-primary hover:underline">Go to sign in</Link></div>
      </Alert>
    );
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={f.handleSubmit(async (v) => {
        setErr(null);
        try {
          await api("/auth/register", { body: { ...v, intent } });
          setDone(true);
        } catch (e) {
          setErr(e instanceof ApiError ? e.message : "Registration failed");
        }
      })}
    >
      {err && <Alert tone="danger">{err}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <Field id="firstName" label="First name" required error={f.formState.errors.firstName?.message}><Input autoComplete="given-name" {...f.register("firstName")} /></Field>
        <Field id="lastName" label="Last name" required error={f.formState.errors.lastName?.message}><Input autoComplete="family-name" {...f.register("lastName")} /></Field>
      </div>
      {askCompany && <Field id="companyName" label={intent === "UNIVERSITY" ? "Institution name" : "Company name"}><Input autoComplete="organization" {...f.register("companyName")} /></Field>}
      <Field id="email" label={intent === "EMPLOYER" ? "Work email" : "Email"} required error={f.formState.errors.email?.message}><Input type="email" autoComplete="email" readOnly={!!inviteEmail} {...f.register("email")} /></Field>
      <Field id="password" label="Password" required hint="At least 12 characters, with a number or symbol." error={f.formState.errors.password?.message}><Input type="password" autoComplete="new-password" {...f.register("password")} /></Field>
      <Checkbox id="acceptTerms" label={<>I agree to the <Link href="/legal/terms" className="text-primary underline" target="_blank">Terms</Link> and have read the <Link href="/legal/privacy" className="text-primary underline" target="_blank">Privacy policy</Link></>} {...f.register("acceptTerms")} />
      {f.formState.errors.acceptTerms && <p className="text-xs text-danger" role="alert">{f.formState.errors.acceptTerms.message}</p>}
      <Checkbox id="marketingOptIn" label="Send me occasional product news (optional)" {...f.register("marketingOptIn")} />
      <Button type="submit" className="w-full" loading={f.formState.isSubmitting}>Create account</Button>
    </form>
  );
}
