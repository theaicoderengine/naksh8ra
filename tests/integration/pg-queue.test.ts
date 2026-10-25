import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/server/db/client";
import { PG_QUEUE, pgEnqueue, claimNext, runClaimed, drain, scheduleDue, queueStats } from "@/server/queue/pg";
import { latestSlot, SCHEDULES } from "@/server/queue/schedules";

// Handlers are replaced so each test controls success/failure precisely.
const handler = vi.fn<(name: string, payload: unknown) => Promise<unknown>>();
vi.mock("@/server/queue/handlers", () => ({ runHandler: (name: string, payload: unknown) => handler(name, payload) }));

async function reset() {
  await prisma.jobRun.deleteMany({ where: { queue: PG_QUEUE } });
  await prisma.jobSchedule.deleteMany({});
  await prisma.jobRunnerHeartbeat.deleteMany({});
}

describe("Postgres job queue (QUEUE_MODE=postgres, Hostinger)", () => {
  beforeEach(async () => {
    handler.mockReset();
    await reset();
  });
  afterEach(reset);

  it("runs a queued job and records COMPLETED only after the handler returned", async () => {
    handler.mockResolvedValue("ok");
    const id = await pgEnqueue("email.send", { deliveryId: "d1" });
    expect((await prisma.jobRun.findUniqueOrThrow({ where: { id } })).status).toBe("QUEUED");
    const counts = await drain({ maxMs: 10_000, concurrency: 1, source: "cli" });
    expect(counts).toEqual({ COMPLETED: 1, RETRY: 0, FAILED: 0 });
    expect(handler).toHaveBeenCalledWith("email.send", { deliveryId: "d1" });
    const row = await prisma.jobRun.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "COMPLETED", attempts: 1, lockedBy: null, error: null });
    expect(row.finishedAt).not.toBeNull();
  });

  it("retries failures with backoff, then leaves the job FAILED with its error", async () => {
    handler.mockRejectedValue(new Error("provider down"));
    const id = await pgEnqueue("resume.parse", { resumeVersionId: "r1", userId: "u1" }, { maxAttempts: 2 });
    expect(await drain({ maxMs: 10_000, concurrency: 1, source: "cli" })).toEqual({ COMPLETED: 0, RETRY: 1, FAILED: 0 });
    let row = await prisma.jobRun.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "QUEUED", attempts: 1, error: "provider down" });
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now()); // backoff: not due yet
    expect(await drain({ maxMs: 2_000, concurrency: 1, source: "cli" })).toEqual({ COMPLETED: 0, RETRY: 0, FAILED: 0 });

    await prisma.jobRun.update({ where: { id }, data: { runAt: new Date(Date.now() - 1000) } });
    expect(await drain({ maxMs: 10_000, concurrency: 1, source: "cli" })).toEqual({ COMPLETED: 0, RETRY: 0, FAILED: 1 });
    row = await prisma.jobRun.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 2, error: "provider down" });
  });

  it("never hands the same job to two concurrent runners", async () => {
    await pgEnqueue("email.send", { deliveryId: "d2" });
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => claimNext(`runner-${i}`)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("processes many jobs exactly once with parallel runners", async () => {
    handler.mockResolvedValue(null);
    for (let i = 0; i < 30; i++) await pgEnqueue("email.send", { deliveryId: `bulk-${i}` });
    await Promise.all([drain({ maxMs: 20_000, concurrency: 3, source: "cli" }), drain({ maxMs: 20_000, concurrency: 3, source: "tick" })]);
    expect(handler).toHaveBeenCalledTimes(30);
    expect(new Set(handler.mock.calls.map((c) => (c[1] as { deliveryId: string }).deliveryId)).size).toBe(30);
    expect(await prisma.jobRun.count({ where: { queue: PG_QUEUE, status: "COMPLETED" } })).toBe(30);
  });

  it("reclaims a job whose runner stopped (lease expired); the stale runner cannot record a result", async () => {
    const id = await pgEnqueue("interview.assess", { sessionId: "s1", organisationId: "o1" });
    const first = await claimNext("runner-dead");
    expect(first?.id).toBe(id);
    expect(await claimNext("runner-other")).toBeNull(); // lease still held
    await prisma.jobRun.update({ where: { id }, data: { lockedUntil: new Date(Date.now() - 1000) } });

    const second = await claimNext("runner-new");
    expect(second).toMatchObject({ id, attempts: 2 });
    handler.mockResolvedValue(null);
    // The stopped runner coming back late must not overwrite the new runner's lease.
    await runClaimed(first!, "runner-dead");
    expect((await prisma.jobRun.findUniqueOrThrow({ where: { id } })).lockedBy).toBe("runner-new");
    await runClaimed(second!, "runner-new");
    expect((await prisma.jobRun.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
  });

  it("fails a job whose runner stopped during its final attempt instead of running it again", async () => {
    const id = await pgEnqueue("dsr.export", { requestId: "x" }, { maxAttempts: 1 });
    await claimNext("runner-dead");
    await prisma.jobRun.update({ where: { id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect(await claimNext("runner-new")).toBeNull();
    const row = await prisma.jobRun.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("FAILED");
    expect(row.error).toMatch(/lease expired/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("schedules each recurring job once per slot, even with concurrent runners", async () => {
    const now = new Date("2026-10-25T10:07:30Z");
    const results = await Promise.all([scheduleDue(now), scheduleDue(now), scheduleDue(now)]);
    const all = results.flat();
    expect(all.sort()).toEqual(SCHEDULES.map((s) => s.name).sort());
    expect(await scheduleDue(new Date("2026-10-25T10:08:00Z"))).toEqual([]); // same slots, jobs still queued
    // Next 5-minute slot: sessions.timeout is due again, but it is still queued, so not duplicated.
    expect(await scheduleDue(new Date("2026-10-25T10:10:00Z"))).toEqual([]);
    await prisma.jobRun.updateMany({ where: { queue: PG_QUEUE }, data: { status: "COMPLETED" } });
    expect((await scheduleDue(new Date("2026-10-25T10:15:00Z"))).sort()).toEqual(["billing.reconcile", "sessions.timeout"]);
  });

  it("computes UTC cron slots", () => {
    expect(latestSlot("*/5 * * * *", new Date("2026-10-25T10:07:59Z")).toISOString()).toBe("2026-10-25T10:05:00.000Z");
    expect(latestSlot("30 3 * * *", new Date("2026-10-25T02:00:00Z")).toISOString()).toBe("2026-10-24T03:30:00.000Z");
    expect(latestSlot("0 * * * *", new Date("2026-10-25T10:00:00Z")).toISOString()).toBe("2026-10-25T10:00:00.000Z");
    expect(() => latestSlot("0 0 1 * *", new Date())).toThrow(/Unsupported/);
  });

  it("reports queue health: due backlog and runner heartbeats", async () => {
    await pgEnqueue("email.send", { deliveryId: "late" });
    await prisma.jobRun.updateMany({ where: { queue: PG_QUEUE }, data: { runAt: new Date(Date.now() - 20 * 60_000) } });
    const s = await queueStats();
    expect(s.queued).toBe(1);
    expect(s.oldestDueSeconds).toBeGreaterThanOrEqual(20 * 60 - 5);
    expect(s.lastSeen).toEqual({});
    handler.mockResolvedValue(null);
    await drain({ maxMs: 5_000, concurrency: 1, source: "tick" });
    expect(Object.keys((await queueStats()).lastSeen)).toEqual(["tick"]);
  });
});
