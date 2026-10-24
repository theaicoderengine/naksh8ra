import { Logo } from "@/components/logo";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-soft/40 to-bg">
      <header className="mx-auto max-w-3xl px-4 py-5"><Logo href="/app" /></header>
      <main id="main" className="mx-auto max-w-3xl px-4 pb-16">{children}</main>
    </div>
  );
}
