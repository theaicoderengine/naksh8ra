"use client";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Accessible modal built on the native <dialog> element (focus trap + Esc handled by the browser). */
export function Dialog({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md" | "lg" }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
      className={cn("w-[calc(100%-2rem)] rounded-xl border border-border bg-surface p-0 text-fg shadow-pop backdrop:bg-black/40", size === "sm" && "max-w-md", size === "md" && "max-w-lg", size === "lg" && "max-w-3xl")}
    >
      {open && (
        <div>
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 id="dialog-title" className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded p-1 text-subtle hover:bg-muted" aria-label="Close dialog"><X className="h-4 w-4" /></button>
          </div>
          {children && <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
