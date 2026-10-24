"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { useToast } from "./ui/toast";

/**
 * Run a mutation, surface success/error, then refresh server components so
 * the page re-renders from the database (single source of truth).
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { success?: string | ((r: R) => string); refresh?: boolean; onSuccess?: (r: R) => void } = {}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);
  const run = React.useCallback(
    async (...args: A) => {
      setPending(true);
      setError(null);
      try {
        const r = await fn(...args);
        if (opts.success) toast(typeof opts.success === "function" ? opts.success(r) : opts.success, "success");
        opts.onSuccess?.(r);
        if (opts.refresh !== false) router.refresh();
        return r;
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError("INTERNAL", "Something went wrong. Please try again.", 0);
        setError(err);
        toast(err.message, "error");
        return undefined;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  );
  return { run, pending, error, fieldErrors: error?.fieldErrors() ?? {} };
}
