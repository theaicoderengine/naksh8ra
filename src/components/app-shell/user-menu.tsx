"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, User, Shield, Repeat } from "lucide-react";
import { api } from "@/lib/api";

export function UserMenu({ name, email, orgs, isStudent, isPlatform }: { name: string; email: string; orgs: { slug: string; name: string }[]; isStudent: boolean; isPlatform: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase() || "?"}</span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-border bg-surface p-1 shadow-pop">
          <div className="px-3 py-2 text-xs text-subtle">{email}</div>
          {orgs.length > 0 && <div className="border-t border-border py-1"><p className="px-3 py-1 text-xs font-medium text-subtle">Workspaces</p>{orgs.map((o) => <Link role="menuitem" key={o.slug} href={`/w/${o.slug}`} className="flex items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-muted"><Repeat className="h-3.5 w-3.5" />{o.name}</Link>)}</div>}
          <div className="border-t border-border py-1">
            {isStudent && <Link role="menuitem" href="/student" className="flex items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-muted"><User className="h-3.5 w-3.5" />Student portal</Link>}
            {isPlatform && <Link role="menuitem" href="/admin" className="flex items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-muted"><Shield className="h-3.5 w-3.5" />Platform admin</Link>}
            <Link role="menuitem" href="/account" className="flex items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-muted"><User className="h-3.5 w-3.5" />Account & security</Link>
            <Link role="menuitem" href="/onboarding/organisation" className="flex items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-muted"><Repeat className="h-3.5 w-3.5" />Create another workspace</Link>
            <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-muted" onClick={async () => { await api("/auth/logout", { method: "POST" }).catch(() => undefined); window.location.href = "/login"; }}><LogOut className="h-3.5 w-3.5" />Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}
