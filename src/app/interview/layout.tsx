import { Logo } from "@/components/logo";
import { brand } from "@/lib/brand";

export const metadata = { title: "Interview", robots: { index: false, follow: false } };

export default function InterviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface"><div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4"><Logo href="#" /><span className="text-xs text-subtle">Secure interview · {brand().name}</span></div></header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 text-center text-xs text-subtle">Need help? Contact the employer who invited you. <a className="underline" href="/legal/privacy" target="_blank">Privacy policy</a></footer>
    </div>
  );
}
