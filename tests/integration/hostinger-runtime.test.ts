import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { env, resetEnvCache } from "@/server/env";
import { enqueue, queueMode } from "@/server/queue";
import { PG_QUEUE } from "@/server/queue/pg";
import { POST as tick } from "@/app/api/internal/jobs/tick/route";
import { GET as jobsHealth } from "@/app/api/health/jobs/route";
import { GET as ready } from "@/app/api/ready/route";

const SECRET = crypto.randomBytes(32).toString("hex");
const saved = { ...process.env };

function withEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

const tickReq = (auth?: string) =>
  new NextRequest("http://localhost:3000/api/internal/jobs/tick", { method: "POST", headers: auth ? { authorization: auth } : {} });

describe("Hostinger runtime: Postgres queue mode end to end", () => {
  beforeEach(async () => {
    withEnv({ QUEUE_MODE: "postgres", CRON_SECRET: SECRET });
    await prisma.jobRun.deleteMany({ where: { queue: PG_QUEUE } });
    await prisma.jobSchedule.deleteMany({});
    await prisma.jobRunnerHeartbeat.deleteMany({});
  });
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });

  it("enqueue() stores a durable job instead of running it inside the request", async () => {
    expect(queueMode()).toBe("postgres");
    await enqueue("ai.reservations.sweep", {});
    const row = await prisma.jobRun.findFirstOrThrow({ where: { queue: PG_QUEUE, name: "ai.reservations.sweep" } });
    expect(row.status).toBe("QUEUED");
  });

  it("the cron tick requires the secret, schedules recurring jobs and runs them with the real handlers", async () => {
    expect((await tick(tickReq())).status).toBe(401);
    expect((await tick(tickReq(`Bearer ${"x".repeat(64)}`))).status).toBe(401);

    // No runner seen yet: job health reports stalled (an uptime monitor would alert).
    expect((await jobsHealth()).status).toBe(503);

    const res = await tick(tickReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.runner).toBe("tick"); // no in-process runner inside the test process
    expect(body.scheduled.length).toBeGreaterThan(0);
    expect(body.processed.FAILED).toBe(0);
    expect(body.processed.COMPLETED).toBe(body.scheduled.length);
    expect(await prisma.jobRun.count({ where: { queue: PG_QUEUE, status: "COMPLETED" } })).toBe(body.scheduled.length);

    // A second tick in the same minute schedules nothing new.
    const again = (await (await tick(tickReq(`Bearer ${SECRET}`))).json()).data;
    expect(again.scheduled).toEqual([]);

    const health = await jobsHealth();
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok", mode: "postgres", healthy: true });
  });

  it("the tick endpoint does not exist in other queue modes", async () => {
    withEnv({ QUEUE_MODE: "inline" });
    expect((await tick(tickReq(`Bearer ${SECRET}`))).status).toBe(404);
  });

  it("readiness reports the database and migrations", async () => {
    const res = await ready();
    expect(res.status).toBe(200);
    expect((await res.json()).checks).toMatchObject({ database: true, migrations: "up_to_date" });
  });
});

describe("Production configuration guards", () => {
  const key = crypto.randomBytes(32).toString("base64");
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });

  it("refuses in-request (inline) jobs in production", () => {
    withEnv({ APP_ENV: "production", ENCRYPTION_KEY: key, ALLOW_FIXTURE_PROVIDERS: "false", QUEUE_MODE: "inline" });
    expect(() => env()).toThrow(/QUEUE_MODE=inline/);
  });

  it("refuses redis mode without REDIS_URL, and postgres mode without a strong CRON_SECRET", () => {
    withEnv({ APP_ENV: "production", ENCRYPTION_KEY: key, ALLOW_FIXTURE_PROVIDERS: "false", QUEUE_MODE: "redis", REDIS_URL: "" });
    expect(() => env()).toThrow(/REDIS_URL/);
    withEnv({ QUEUE_MODE: "postgres", CRON_SECRET: "short" });
    expect(() => env()).toThrow(/CRON_SECRET/);
    withEnv({ CRON_SECRET: SECRET, STORAGE_PROVIDER: "s3", S3_BUCKET: "atlas-files", ALLOW_UNSCANNED_UPLOADS: "true", APP_URL: "https://atlas.example.com" });
    expect(env().QUEUE_MODE).toBe("postgres");
  });

  it("refuses local disk storage, silently unscanned uploads and a non-https origin in production", () => {
    const base = { APP_ENV: "production", ENCRYPTION_KEY: key, ALLOW_FIXTURE_PROVIDERS: "false", QUEUE_MODE: "postgres", CRON_SECRET: SECRET, APP_URL: "https://atlas.example.com" };
    withEnv({ ...base, STORAGE_PROVIDER: "local", ALLOW_LOCAL_STORAGE: undefined, MALWARE_SCANNER: "none", ALLOW_UNSCANNED_UPLOADS: "true" });
    expect(() => env()).toThrow(/STORAGE_PROVIDER=local/);
    withEnv({ STORAGE_PROVIDER: "s3", S3_BUCKET: "atlas-files", ALLOW_UNSCANNED_UPLOADS: undefined });
    expect(() => env()).toThrow(/ALLOW_UNSCANNED_UPLOADS/);
    withEnv({ ALLOW_UNSCANNED_UPLOADS: "true", APP_URL: "http://atlas.example.com" });
    expect(() => env()).toThrow(/https/);
    withEnv({ APP_URL: "https://atlas.example.com" });
    expect(env().STORAGE_PROVIDER).toBe("s3");
  });
});
