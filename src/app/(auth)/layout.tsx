import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-primary-soft/50 to-bg">
      <header className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6"><Logo /></header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
