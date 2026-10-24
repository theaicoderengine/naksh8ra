"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const ITEMS = [
  ["/student", "Dashboard"],
  ["/student/jobs", "Opportunities"],
  ["/student/applications", "Applications"],
  ["/student/saved", "Saved"],
  ["/student/practice", "Practice"],
  ["/student/profile", "Profile"],
  ["/student/resumes", "Resumes"],
  ["/student/settings", "Settings"],
];

export function StudentNav() {
  const p = usePathname();
  return (
    <nav aria-label="Student portal" className="flex gap-1 overflow-x-auto">
      {ITEMS.map(([href, label]) => {
        const active = href === "/student" ? p === href : p.startsWith(href);
        return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-sm", active ? "bg-primary-soft font-medium text-primary" : "text-subtle hover:bg-muted hover:text-fg")}>{label}</Link>;
      })}
    </nav>
  );
}
