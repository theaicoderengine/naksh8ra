"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { api } from "@/lib/api";
import { fmtRelative } from "@/lib/format";

type N = { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: N[]; unread: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const load = () => api<{ items: N[]; unread: number }>("/notifications").then(setData).catch(() => undefined);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => {
      clearInterval(t);
      document.removeEventListener("mousedown", h);
    };
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="relative rounded p-2 hover:bg-muted" aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell className="h-4 w-4" />
        {!!data?.unread && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" aria-hidden="true" />}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-lg border border-border bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {!!data?.unread && <button type="button" className="text-xs text-primary hover:underline" onClick={async () => { await api("/notifications/read", { body: {} }); load(); }}>Mark all read</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {!data?.items.length && <li className="px-4 py-6 text-center text-sm text-subtle">You&apos;re all caught up.</li>}
            {data?.items.map((n) => (
              <li key={n.id} className={`border-b border-border px-4 py-3 text-sm last:border-0 ${n.readAt ? "" : "bg-primary-soft/40"}`}>
                {n.link ? <Link href={n.link} className="font-medium hover:underline" onClick={() => setOpen(false)}>{n.title}</Link> : <p className="font-medium">{n.title}</p>}
                <p className="text-subtle">{n.body}</p>
                <p className="mt-0.5 text-xs text-subtle">{fmtRelative(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
