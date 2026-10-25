import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "./errors";

/**
 * Per-request time budget. Hosting platforms cut requests off (Hostinger: 120 s), so
 * provider calls made inside a request must finish — successfully or with a clean error —
 * before that happens. Background jobs run without a deadline.
 */
const store = new AsyncLocalStorage<{ deadlineAt: number }>();

/** Time kept back for the work after a provider call (DB writes, response). */
const RESERVE_MS = 5_000;
/** Below this, starting another provider attempt is pointless. */
const MIN_ATTEMPT_MS = 3_000;

export function runWithDeadline<T>(budgetMs: number, fn: () => Promise<T>): Promise<T> {
  if (!budgetMs || budgetMs <= 0) return fn();
  return store.run({ deadlineAt: Date.now() + budgetMs }, fn);
}

/** Milliseconds left for provider work in this request (Infinity outside a request). */
export function remainingMs(): number {
  const d = store.getStore();
  return d ? d.deadlineAt - Date.now() - RESERVE_MS : Infinity;
}

export function hasDeadline(): boolean {
  return !!store.getStore();
}

/** Timeout for one provider attempt: the configured timeout, capped by the request budget. */
export function attemptTimeoutMs(configured: number): number {
  const left = remainingMs();
  if (left < MIN_ATTEMPT_MS) {
    throw new AppError("PROVIDER_ERROR", "The AI provider is not responding. Please try again shortly.", { reason: "timeout", deadline: true });
  }
  return Math.min(configured, Math.floor(left));
}

/** Whether there is time for a retry after waiting `delayMs`. */
export function canRetryWithin(delayMs: number): boolean {
  return remainingMs() - delayMs >= MIN_ATTEMPT_MS;
}
