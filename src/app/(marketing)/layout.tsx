import Link from "next/link";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";
import { brand } from "@/lib/brand";
import { currentSession } from "@/server/auth/session";

const NAV = [
  { href: "/features", label: "Product" },
  { href: "/ai-interviews", label: "AI interviews" },
  { href: "/solutions/enterprise", label: "Solutions" },
  { href: "/solutions/campus", label: "Campus" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
  { href: "/jobs", label: "Jobs" },
];

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded px-3 py-2 text-sm text-subtle hover:bg-muted hover:text-fg">{n.label}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {session ? (
              <ButtonLink href="/app" size="sm">Open app</ButtonLink>
            ) : (
              <>
                <ButtonLink href="/login" variant="ghost" size="sm">Sign in</ButtonLink>
                <ButtonLink href="/register" size="sm">Get started</ButtonLink>
              </>
            )}
          </div>
        </div>
        <nav aria-label="Main (mobile)" className="flex gap-1 overflow-x-auto border-t border-border/60 px-4 py-1.5 lg:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded px-2.5 py-1 text-sm text-subtle hover:bg-muted">{n.label}</Link>
          ))}
        </nav>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-subtle">{brand().tagline}. Structured interviews, transparent evidence and human decisions.</p>
          </div>
          {[
            { h: "Product", l: [["/features", "Features"], ["/ai-interviews", "AI interviews"], ["/pricing", "Pricing"], ["/docs", "Documentation"]] },
            { h: "Solutions", l: [["/solutions/enterprise", "Enterprise"], ["/solutions/recruitment-teams", "Recruitment teams"], ["/solutions/graduates", "Students & graduates"], ["/solutions/campus", "Campus placement"]] },
            { h: "Company", l: [["/contact", "Contact sales"], ["/security", "Security & privacy"], ["/legal/terms", "Terms"], ["/legal/privacy", "Privacy policy"], ["/legal/cookies", "Cookies"]] },
          ].map((c) => (
            <div key={c.h}>
              <p className="text-sm font-semibold">{c.h}</p>
              <ul className="mt-3 space-y-2">
                {c.l.map(([href, label]) => (
                  <li key={href}><Link href={href} className="text-sm text-subtle hover:text-fg">{label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-border py-4 text-center text-xs text-subtle">© {new Date().getFullYear()} {brand().legalEntity}. {brand().name} is a working product name.</div>
      </footer>
    </div>
  );
}
