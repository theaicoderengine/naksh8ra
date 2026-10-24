"use client";
import { api } from "@/lib/api";
import { useAction } from "../use-action";
import { ConfirmButton } from "../confirm";

export function WithdrawButton({ id }: { id: string }) {
  const w = useAction((reason: string) => api(`/students/me/applications/${id}/withdraw`, { body: { reason: reason || undefined } }), { success: "Application withdrawn" });
  return <ConfirmButton label="Withdraw application" title="Withdraw this application?" description="The employer will see that you withdrew. Pending interviews are cancelled. This can't be undone." onConfirm={(r) => w.run(r)} />;
}
