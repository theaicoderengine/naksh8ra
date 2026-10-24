import { prisma } from "./db/client";
import { AppError } from "./errors";
import { getRedis } from "./queue/redis";

export type RateLimitRule = { key: string; limit: number; windowSec: number };

export const RULES = {
  login: { limit: 10, windowSec: 15 * 60 },
  loginAccount: { limit: 5, windowSec: 15 * 60 },
  register: { limit: 10, windowSec: 60 * 60 },
  passwordReset: { limit: 5, windowSec: 60 * 60 },
  verifyResend: { limit: 5, windowSec: 60 * 60 },
  mutation: { limit: 120, windowSec: 60 },
  upload: { limit: 30, windowSec: 60 * 10 },
  interviewTurn: { limit: 60, windowSec: 60 },
  ai: { limit: 30, windowSec: 60 },
  contact: { limit: 5, windowSec: 60 * 60 },
  invitationOpen: { limit: 30, windowSec: 60 * 10 },
} as const;

/** Returns remaining requests, or throws RATE_LIMITED. Uses Redis when configured, else Postgres. */
export async function rateLimit(name: keyof typeof RULES, subject: string) {
  const rule = RULES[name];
  const key = `rl:${name}:${subject}`;
  const redis = getRedis();
  let count: number;
  let resetAt: number;
  if (redis) {
    const res = await redis.multi().incr(key).pttl(key).exec();
    count = Number(res?.[0]?.[1] ?? 1);
    let ttl = Number(res?.[1]?.[1] ?? -1);
    if (ttl < 0) {
      await redis.pexpire(key, rule.windowSec * 1000);
      ttl = rule.windowSec * 1000;
    }
    resetAt = Date.now() + ttl;
  } else {
    const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (${key}, 1, now() + make_interval(secs => ${rule.windowSec}))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."resetAt" < now() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" < now() THEN now() + make_interval(secs => ${rule.windowSec}) ELSE "RateLimitBucket"."resetAt" END
      RETURNING "count", "resetAt"`;
    count = Number(rows[0].count);
    resetAt = rows[0].resetAt.getTime();
  }
  if (count > rule.limit) {
    throw new AppError("RATE_LIMITED", "Too many requests. Please try again later.", {
      retryAfterSec: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    });
  }
  return rule.limit - count;
}

export async function resetRateLimit(name: keyof typeof RULES, subject: string) {
  const key = `rl:${name}:${subject}`;
  const redis = getRedis();
  if (redis) await redis.del(key);
  else await prisma.rateLimitBucket.deleteMany({ where: { key } });
}
