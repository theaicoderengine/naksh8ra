"use client";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { useOrg } from "./org-context";
import { Button } from "../ui/button";

export function CheckoutButton({ planKey, packKey, label, variant = "primary" }: { planKey?: string; packKey?: string; label: string; variant?: "primary" | "secondary" }) {
  const org = useOrg();
  const a = useAction(() => api<{ url: string }>("/billing/checkout", { org: org.slug, body: { planKey, packKey } }), { refresh: false, onSuccess: (r) => { window.location.href = r.url; } });
  if (!org.can("billing.manage")) return null;
  return <Button variant={variant} size="sm" loading={a.pending} onClick={() => a.run()}>{label}</Button>;
}

export function PortalButton() {
  const org = useOrg();
  const a = useAction(() => api<{ url: string }>("/billing/portal", { org: org.slug, method: "POST" }), { refresh: false, onSuccess: (r) => { window.location.href = r.url; } });
  if (!org.can("billing.manage")) return null;
  return <Button variant="secondary" loading={a.pending} onClick={() => a.run()}>Manage billing & payment methods</Button>;
}
