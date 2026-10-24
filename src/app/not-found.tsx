import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="mt-2 text-2xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="mt-2 max-w-md text-sm text-subtle">It may have moved, or you may not have access to it.</p>
      <ButtonLink href="/app" className="mt-6">Go to your dashboard</ButtonLink>
    </main>
  );
}
