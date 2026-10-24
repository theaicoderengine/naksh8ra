import IORedis, { type Redis } from "ioredis";

let client: Redis | null | undefined;

/** Shared Redis connection, or null when REDIS_URL is not configured. */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    client = null;
    return null;
  }
  client = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
  client.on("error", () => undefined);
  return client;
}

export function newRedisConnection(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for the background worker");
  return new IORedis(url, { maxRetriesPerRequest: null });
}
