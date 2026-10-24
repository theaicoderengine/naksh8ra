"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Briefcase, Users, Mic, FileText, Scale, UserCog, Settings, CreditCard, ScrollText, GraduationCap, BarChart3, Handshake, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/cn";
import { useOrg } from "./org-context";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; perm?: string | string[]; type?: "EMPLOYER" | "UNIVERSITY" };

const ITEMS: Item[] = [
  { href: "", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase, perm: ["jobs.view_all", "jobs.view_assigned"], type: "EMPLOYER" },
  { href: "/candidates", label: "Candidates", icon: Users, perm: ["candidates.view_all", "candidates.view_assigned"], type: "EMPLOYER" },
  { href: "/interviews", label: "Interviews", icon: Mic, perm: ["candidates.view_all", "candidates.view_assigned"], type: "EMPLOYER" },
  { href: "/templates", label: "Interview templates", icon: FileText, perm: "interviews.configure", type: "EMPLOYER" },
  { href: "/competencies", label: "Competencies", icon: Scale, perm: "interviews.configure", type: "EMPLOYER" },
  { href: "/programmes", label: "Campus programmes", icon: Handshake, perm: "jobs.view_all", type: "EMPLOYER" },
  { href: "/cohorts", label: "Cohorts", icon: GraduationCap, perm: "university.students.view", type: "UNIVERSITY" },
  { href: "/placement", label: "Programmes", icon: Handshake, perm: "university.students.view", type: "UNIVERSITY" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, perm: "analytics.view" },
  { href: "/team", label: "Team", icon: UserCog, perm: "members.view" },
  { href: "/billing", label: "Billing & credits", icon: CreditCard, perm: "billing.view" },
  { href: "/audit", label: "Audit log", icon: ScrollText, perm: "audit.view" },
  { href: "/settings", label: "Settings", icon: Settings, perm: "org.view" },
  { href: "/support", label: "Support", icon: LifeBuoy, perm: "support.request" },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const org = useOrg();
  const pathname = usePathname();
  const base = `/w/${org.slug}`;
  const visible = ITEMS.filter((i) => (!i.type || i.type === org.type) && (!i.perm || (Array.isArray(i.perm) ? i.perm.some((p) => org.can(p)) : org.can(i.perm))));
  return (
    <nav aria-label="Workspace" className="space-y-0.5">
      {visible.map((i) => {
        const href = base + i.href;
        const active = i.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link key={i.href} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded px-3 py-2 text-sm transition-colors", active ? "bg-primary-soft font-medium text-primary" : "text-subtle hover:bg-muted hover:text-fg")}>
            <i.icon className="h-4 w-4" aria-hidden="true" />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
