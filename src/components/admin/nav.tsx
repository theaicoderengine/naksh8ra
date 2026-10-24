"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const ITEMS = [["/admin", "Overview"], ["/admin/organisations", "Organisations"], ["/admin/plans", "Plans & credits"], ["/admin/health", "Operations"], ["/admin/flags", "Flags & settings"], ["/admin/tickets", "Support"], ["/admin/privacy", "Privacy requests"], ["/admin/audit", "Security audit"], ["/admin/admins", "Administrators"]];

export function AdminNav() {
  const p = usePathname();
  return (
    <nav aria-label="Platform admin" className="space-y-0.5">
      {ITEMS.map(([h, l]) => {
        const active = h === "/admin" ? p === h : p.startsWith(h);
        return <Link key={h} href={h} aria-current={active ? "page" : undefined} className={cn("block rounded px-3 py-2 text-sm", active ? "bg-primary-soft font-medium text-primary" : "text-subtle hover:bg-muted hover:text-fg")}>{l}</Link>;
      })}
    </nav>
  );
}
