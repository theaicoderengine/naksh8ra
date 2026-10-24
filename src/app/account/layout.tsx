import Link from "next/link";
import { requirePageSession } from "@/server/auth/page";
import { listMyOrganisations } from "@/server/services/organisations";
import { Logo } from "@/components/logo";
import { UserMenu } from "@/components/app-shell/user-menu";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePageSession();
  const orgs = await listMyOrganisations(s.user.id);
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface"><div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4"><Logo href="/app" /><UserMenu name={[s.user.firstName, s.user.lastName].filter(Boolean).join(" ") || s.user.email} email={s.user.email} orgs={orgs} isStudent={s.user.isStudent} isPlatform={s.user.platformRole !== "NONE"} /></div></header>
      <div className="mx-auto max-w-4xl px-4 py-6">
        <nav aria-label="Account" className="mb-6 flex gap-2 text-sm">{[["/account", "Profile"], ["/account/security", "Security"], ["/account/privacy", "Privacy"], ["/account/support", "Support"]].map(([h, l]) => <Link key={h} href={h} className="rounded-full px-3 py-1.5 text-subtle hover:bg-muted hover:text-fg">{l}</Link>)}<Link href="/app" className="ml-auto rounded-full px-3 py-1.5 text-primary hover:bg-muted">Back to app →</Link></nav>
        <main id="main">{children}</main>
      </div>
    </div>
  );
}
