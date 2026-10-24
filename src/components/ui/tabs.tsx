"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

/** URL-driven tabs (?tab=...) so state survives refresh and is linkable. */
export function Tabs({ tabs, param = "tab" }: { tabs: { key: string; label: React.ReactNode; count?: number }[]; param?: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = sp.get(param) ?? tabs[0]?.key;
  return (
    <nav aria-label="Sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const q = new URLSearchParams(sp.toString());
        q.set(param, t.key);
        const active = t.key === current;
        return (
          <Link key={t.key} href={`${pathname}?${q.toString()}`} aria-current={active ? "page" : undefined} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors", active ? "border-primary text-primary" : "border-transparent text-subtle hover:text-fg")}>
            {t.label}
            {t.count != null && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs text-subtle">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
