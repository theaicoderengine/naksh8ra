import { logger } from "../logger";
import { drain, heartbeat, scheduleDue } from "./pg";

/**
 * In-process runner for the Postgres queue: the web server process works through due jobs
 * between requests. Hosts such as Hostinger run one long-lived Node process per site and no
 * separate workers, and may stop an idle process — so this runner is paired with an external
 * cron call to /api/internal/jobs/tick that wakes the site and schedules recurring jobs.
 * A job interrupted by a stop is reclaimed by the next runner when its lease expires.
 */
type State = { timer: NodeJS.Timeout | null; busy: boolean; stopped: boolean; wake: boolean };

declare global {
  var __atlasJobRunner: State | undefined;
}

const POLL_MS = 5_000;
const SCHEDULE_EVERY_MS = 60_000;
let lastScheduled = 0;

function state(): State {
  globalThis.__atlasJobRunner ??= { timer: null, busy: false, stopped: true, wake: false };
  return globalThis.__atlasJobRunner;
}

async function cycle(concurrency: number) {
  const s = state();
  if (s.busy || s.stopped) {
    s.wake = true;
    return;
  }
  s.busy = true;
  try {
    do {
      s.wake = false;
      if (Date.now() - lastScheduled >= SCHEDULE_EVERY_MS) {
        lastScheduled = Date.now();
        await scheduleDue();
      }
      await drain({ maxMs: 5 * 60_000, concurrency, source: "in-process" });
    } while (s.wake && !s.stopped);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "job runner cycle failed");
  } finally {
    s.busy = false;
  }
}

export function startInProcessRunner(concurrency: number) {
  const s = state();
  if (!s.stopped) return;
  s.stopped = false;
  const loop = () => {
    if (s.stopped) return;
    void cycle(concurrency).finally(() => {
      if (!s.stopped) s.timer = setTimeout(loop, POLL_MS);
    });
  };
  loop();
  void heartbeat("in-process").catch(() => undefined);
  logger.info({ concurrency, pollMs: POLL_MS }, "in-process job runner started");
}

/** Start work now (after an enqueue or a cron tick) instead of waiting for the next poll. */
export function kickRunner(concurrency: number) {
  const s = state();
  if (s.stopped) return false;
  void cycle(concurrency);
  return true;
}

export function isRunnerActive() {
  return !state().stopped;
}

export function stopInProcessRunner() {
  const s = state();
  s.stopped = true;
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
}
