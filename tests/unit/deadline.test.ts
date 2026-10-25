import { describe, it, expect } from "vitest";
import { runWithDeadline, remainingMs, attemptTimeoutMs, canRetryWithin, hasDeadline } from "@/server/deadline";

describe("request deadline (host request cut-off)", () => {
  it("has no limit outside a request", () => {
    expect(hasDeadline()).toBe(false);
    expect(remainingMs()).toBe(Infinity);
    expect(attemptTimeoutMs(60_000)).toBe(60_000);
    expect(canRetryWithin(10_000)).toBe(true);
  });

  it("caps provider timeouts to the time left, keeping a reserve for the response", async () => {
    await runWithDeadline(30_000, async () => {
      expect(hasDeadline()).toBe(true);
      const t = attemptTimeoutMs(60_000);
      expect(t).toBeLessThanOrEqual(25_000);
      expect(t).toBeGreaterThan(24_000);
      expect(attemptTimeoutMs(10_000)).toBe(10_000);
      expect(canRetryWithin(30_000)).toBe(false);
      expect(canRetryWithin(1_000)).toBe(true);
    });
  });

  it("refuses to start an attempt that cannot finish in time", async () => {
    await runWithDeadline(6_000, async () => {
      expect(() => attemptTimeoutMs(60_000)).toThrow(/not responding/);
    });
  });

  it("is isolated per request", async () => {
    const seen: number[] = [];
    await Promise.all([
      runWithDeadline(100_000, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(remainingMs());
      }),
      runWithDeadline(20_000, async () => {
        seen.push(remainingMs());
      }),
    ]);
    expect(Math.max(...seen)).toBeGreaterThan(90_000);
    expect(Math.min(...seen)).toBeLessThan(16_000);
  });
});

describe("client IP behind a proxy", () => {
  it("uses the entry appended by the trusted proxy, not a client-forged one", async () => {
    const { clientIp } = await import("@/server/http/route");
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    const saved = { trust: process.env.TRUST_PROXY, hops: process.env.TRUST_PROXY_HOPS };
    try {
      process.env.TRUST_PROXY = "true";
      delete process.env.TRUST_PROXY_HOPS;
      expect(clientIp(h)).toBe("203.0.113.9");
      process.env.TRUST_PROXY_HOPS = "2"; // CDN + proxy
      expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.7, 10.0.0.2" }))).toBe("198.51.100.7");
      process.env.TRUST_PROXY_HOPS = "9";
      expect(clientIp(h)).toBe("6.6.6.6");
    } finally {
      if (saved.trust === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = saved.trust;
      if (saved.hops === undefined) delete process.env.TRUST_PROXY_HOPS;
      else process.env.TRUST_PROXY_HOPS = saved.hops;
    }
  });
});
