import type { JobName } from "./index";

/** Recurring maintenance jobs (UTC). Shared by the Redis worker and the Postgres queue. */
export const SCHEDULES: { name: JobName; pattern: string }[] = [
  { name: "sessions.timeout", pattern: "*/5 * * * *" },
  { name: "ai.reservations.sweep", pattern: "*/10 * * * *" },
  { name: "interview.reminders", pattern: "0 * * * *" },
  { name: "retention.sweep", pattern: "30 3 * * *" },
  { name: "billing.reconcile", pattern: "15 * * * *" },
];

function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  const step = /^\*\/(\d+)$/.exec(field);
  if (step) return value % Number(step[1]) === 0;
  if (/^\d+$/.test(field)) return Number(field) === value;
  throw new Error(`Unsupported cron field "${field}"`);
}

/**
 * The most recent minute at or before `now` matching a 5-field cron pattern (UTC).
 * Supports minute/hour fields of `*`, `*\/n` or a number; day/month/weekday must be `*`.
 */
export function latestSlot(pattern: string, now: Date): Date {
  const [min, hour, ...rest] = pattern.trim().split(/\s+/);
  if (rest.length !== 3 || rest.some((f) => f !== "*")) throw new Error(`Unsupported cron pattern "${pattern}"`);
  const t = new Date(now);
  t.setUTCSeconds(0, 0);
  for (let i = 0; i <= 2 * 24 * 60; i++) {
    if (fieldMatches(min, t.getUTCMinutes()) && fieldMatches(hour, t.getUTCHours())) return t;
    t.setUTCMinutes(t.getUTCMinutes() - 1);
  }
  throw new Error(`Cron pattern "${pattern}" never matches`);
}
