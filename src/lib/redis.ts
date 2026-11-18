import { Redis } from "ioredis";
import { config } from "../config";

/**
 * Redis is optional. When REDIS_URL is not configured (or Redis is down),
 * every cache helper silently falls back to hitting the database.
 */
let client: Redis | null = null;

const getClient = (): Redis | null => {
  if (!config.redisUrl) return null;
  if (client) return client;

  client = new Redis(config.redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
  });
  client.on("error", (err) => {
    if (!config.isProduction) console.warn("[redis]", err.message);
  });
  return client;
};

const isReady = (r: Redis | null): r is Redis => !!r && r.status === "ready";

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    const r = getClient();
    if (!isReady(r)) return null;
    try {
      const raw = await r.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    const r = getClient();
    if (!isReady(r)) return;
    try {
      await r.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      /* cache failures must never break a request */
    }
  },

  /** Read-through cache: returns the cached value or computes, stores and returns it. */
  async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const hit = await cache.get<T>(key);
    if (hit !== null) return hit;
    const fresh = await loader();
    await cache.set(key, fresh, ttlSeconds);
    return fresh;
  },

  /** Delete every key that starts with the given prefix (uses SCAN, never KEYS). */
  async invalidate(prefix: string): Promise<void> {
    const r = getClient();
    if (!isReady(r)) return;
    try {
      let cursor = "0";
      do {
        const [next, keys] = await r.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
        cursor = next;
        if (keys.length) await r.del(...keys);
      } while (cursor !== "0");
    } catch {
      /* ignore */
    }
  },

  isEnabled: () => isReady(getClient()),
};

export const CacheKeys = {
  hospitals: "hospitals:",
  dashboard: "admin:dashboard",
  reports: "admin:reports:",
} as const;
