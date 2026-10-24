"use client";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "../logo";
import { Sidebar } from "./sidebar";
import { useOrg } from "./org-context";
import { Badge } from "../ui/badge";

export function WorkspaceShell({ header, banner, children }: { header: React.ReactNode; banner?: React.ReactNode; children: React.ReactNode }) {
  const org = useOrg();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-border bg-surface transition-transform lg:static lg:w-auto lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-14 items-center justify-between border-b border-border px-4"><Logo href={`/w/${org.slug}`} /><button type="button" className="rounded p-1 lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></div>
        <div className="border-b border-border px-4 py-3">
          <p className="truncate text-sm font-semibold" title={org.name}>{org.name}</p>
          <div className="mt-1 flex gap-1.5"><Badge tone="primary">{org.role.replace(/_/g, " ").toLowerCase()}</Badge>{org.type === "UNIVERSITY" && <Badge tone="accent">University</Badge>}</div>
        </div>
        <div className="p-3"><Sidebar onNavigate={() => setOpen(false)} /></div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
          <button type="button" className="rounded p-1.5 hover:bg-muted lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
          <div className="flex-1" />
          {header}
        </header>
        {banner}
        <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
