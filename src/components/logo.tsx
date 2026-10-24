import Link from "next/link";
import { brand } from "@/lib/brand";

export function Logo({ href = "/", compact }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-semibold text-fg" aria-label={`${brand().name} home`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path d="M9 23 16 8l7 15M11.8 17.5h8.4" stroke="white" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && <span className="text-[15px] tracking-tight">{brand().name}</span>}
    </Link>
  );
}
