"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import type { z } from "zod";
import { contactForm } from "@/lib/schemas";
import { api, ApiError } from "@/lib/api";
import { Field, Input, Select, Textarea } from "./ui/form";
import { Button } from "./ui/button";
import { Alert } from "./ui/feedback";

export function ContactForm() {
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const f = useForm<z.infer<typeof contactForm>>({ resolver: zodResolver(contactForm), defaultValues: { topic: "SALES" } });
  if (done) return <Alert tone="success" title="Message sent">{done}</Alert>;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={f.handleSubmit(async (v) => {
        setErr(null);
        try {
          const r = await api<{ message: string }>("/contact", { body: v });
          setDone(r.message);
        } catch (e) {
          setErr(e instanceof ApiError ? e.message : "Could not send your message");
        }
      })}
    >
      {err && <Alert tone="danger">{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Name" required error={f.formState.errors.name?.message}><Input autoComplete="name" {...f.register("name")} /></Field>
        <Field id="email" label="Work email" required error={f.formState.errors.email?.message}><Input type="email" autoComplete="email" {...f.register("email")} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="company" label="Company"><Input autoComplete="organization" {...f.register("company")} /></Field>
        <Field id="topic" label="Topic"><Select {...f.register("topic")}><option value="SALES">Sales</option><option value="SUPPORT">Support</option><option value="PRIVACY">Privacy</option><option value="PARTNERSHIP">Partnerships / universities</option></Select></Field>
      </div>
      <Field id="message" label="How can we help?" required error={f.formState.errors.message?.message}><Textarea rows={5} {...f.register("message")} /></Field>
      <Button type="submit" loading={f.formState.isSubmitting}>Send message</Button>
    </form>
  );
}
