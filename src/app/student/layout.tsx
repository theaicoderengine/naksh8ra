import { redirect } from "next/navigation";
import { requireVerifiedPage } from "@/server/auth/page";
import { ensureStudentProfile } from "@/server/services/students";
import { listMyOrganisations } from "@/server/services/organisations";
import { Logo } from "@/components/logo";
import { StudentNav } from "@/components/student/nav";
import { UserMenu } from "@/components/app-shell/user-menu";
import { NotificationsBell } from "@/components/app-shell/notifications-bell";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const s = await requireVerifiedPage();
  const p = await ensureStudentProfile(s);
  const path = (await headers()).get("x-pathname") ?? "";
  if (!p.onboardingCompletedAt && !path.startsWith("/student/profile")) redirect("/onboarding/student");
  const orgs = await listMyOrganisations(s.user.id);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo href="/student" />
          <div className="flex items-center gap-1"><NotificationsBell /><UserMenu name={[s.user.firstName, s.user.lastName].filter(Boolean).join(" ") || s.user.email} email={s.user.email} orgs={orgs} isStudent={false} isPlatform={s.user.platformRole !== "NONE"} /></div>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-2 sm:px-6"><StudentNav /></div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
