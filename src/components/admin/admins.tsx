"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { Input, Select } from "../ui/form";
import { ConfirmButton } from "../confirm";

export function SetAdminRole() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("SUPPORT");
  const set = useAction((reason: string) => api("/platform/admins", { body: { email, role, reason } }), { success: "Role updated — the user's sessions were signed out" });
  return (
    <div className="flex flex-wrap gap-2">
      <Input aria-label="User email" placeholder="user@example.com" className="w-72" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Select aria-label="Platform role" className="w-48" value={role} onChange={(e) => setRole(e.target.value)}><option value="SUPPORT">Support</option><option value="BILLING_ADMIN">Billing admin</option><option value="SUPER_ADMIN">Super admin</option><option value="NONE">Remove platform access</option></Select>
      <ConfirmButton variant="primary" label="Apply" disabled={!email.includes("@")} title={`Set ${email} to ${role}?`} description="Platform roles grant operator access. The user must enable MFA before using it." requireReason onConfirm={(r) => set.run(r)} />
    </div>
  );
}
