import * as React from "react";
import { cn } from "@/lib/cn";

export function Table({ className, children, caption }: { className?: string; children: React.ReactNode; caption?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border bg-surface", className)}>
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
export function Th({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("border-b border-border bg-muted/50 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-subtle", className)} {...p} />;
}
export function Td({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-border px-4 py-3 align-middle last:border-r-0", className)} {...p} />;
}
export function Tr({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-muted/40 [&:last-child>td]:border-b-0", className)} {...p} />;
}
