import * as React from "react";
import { cn } from "@/lib/cn";

const base = "w-full rounded border border-border bg-surface px-3 text-sm text-fg placeholder:text-subtle/70 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(base, "h-10", className)} {...p} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(base, "min-h-[96px] py-2 leading-relaxed", className)} {...p} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(base, "h-10 pr-8", className)} {...p}>
      {children}
    </select>
  );
});

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-fg", className)} {...p} />;
}

/** Labelled field with hint and error, wired for screen readers. */
export function Field({ id, label, hint, error, required, children, className }: { id: string; label: React.ReactNode; hint?: React.ReactNode; error?: string; required?: boolean; children: React.ReactElement<Record<string, unknown>>; className?: string }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-0", className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
      </Label>
      {React.cloneElement(children, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, required })}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-subtle">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}

export function Checkbox({ id, label, description, className, ...p }: { id: string; label: React.ReactNode; description?: React.ReactNode } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary accent-[rgb(var(--primary))]" {...p} />
      <div>
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {description && <p className="text-xs text-subtle">{description}</p>}
      </div>
    </div>
  );
}
