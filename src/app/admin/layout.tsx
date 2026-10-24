import { requirePlatformPage } from "@/server/auth/page";
import { Logo } from "@/components/logo";
import { AdminNav } from "@/components/admin/nav";
import { UserMenu } from "@/components/app-shell/user-menu";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform admin", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePlatformPage();
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="border-b border-border bg-surface lg:border-b-0 lg:border-r">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4"><Logo href="/admin" compact /><span className="text-sm font-semibold">Platform</span><Badge tone="warning">{s.user.platformRole.replace("_", " ").toLowerCase()}</Badge></div>
        <div className="p-3"><AdminNav /></div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-14 items-center justify-end border-b border-border bg-surface px-6"><UserMenu name={s.user.email} email={s.user.email} orgs={[]} isStudent={false} isPlatform={false} /></header>
        <main id="main" className="mx-auto max-w-7xl px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
