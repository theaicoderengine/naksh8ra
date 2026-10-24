"use client";
import * as React from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea, Label } from "./ui/form";

/** Confirmation for destructive/financial actions. Optionally requires a reason (recorded in the audit log). */
export function ConfirmButton({ label, title, description, confirmLabel = "Confirm", requireReason, onConfirm, variant = "danger", size = "sm", disabled }: { label: React.ReactNode; title: string; description?: React.ReactNode; confirmLabel?: string; requireReason?: boolean; onConfirm: (reason: string) => Promise<unknown>; variant?: "danger" | "primary" | "secondary"; size?: "sm" | "md"; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} disabled={disabled}>{label}</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant={variant === "secondary" ? "primary" : variant}
              loading={busy}
              disabled={requireReason && reason.trim().length < 5}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm(reason.trim());
                  setOpen(false);
                  setReason("");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        {requireReason && (
          <div>
            <Label htmlFor="confirm-reason">Reason (recorded in the audit log)</Label>
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="At least 5 characters" />
          </div>
        )}
      </Dialog>
    </>
  );
}
