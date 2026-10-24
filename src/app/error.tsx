"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-subtle">The error has been logged{error.digest ? ` (reference ${error.digest})` : ""}. Your data is safe — please try again.</p>
      <Button className="mt-6" onClick={reset}>Try again</Button>
    </main>
  );
}
