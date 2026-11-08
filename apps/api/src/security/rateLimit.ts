import type { Context, MiddlewareHandler } from "hono";

export type RateLimitOptions = {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  /** Bucket for the request; requests with the same key share the limit. */
  key: (c: Context) => string;
  /** Hard cap on tracked keys, so a flood of spoofed keys can't exhaust memory. */
  maxKeys?: number;
  now?: () => number;
};

type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window limiter kept in memory. The API runs as one process on one server,
 * so there is nothing to share between instances.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { limit, windowMs, key, maxKeys = 10_000, now = Date.now } = options;
  const buckets = new Map<string, Bucket>();

  return async (c, next) => {
    const t = now();
    const k = key(c);
    let bucket = buckets.get(k);
    if (!bucket || bucket.resetAt <= t) {
      if (!bucket && buckets.size >= maxKeys) {
        for (const [name, b] of buckets) if (b.resetAt <= t) buckets.delete(name);
      }
      if (!bucket && buckets.size >= maxKeys) return tooMany(c, windowMs);
      bucket = { count: 0, resetAt: t + windowMs };
      buckets.set(k, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) return tooMany(c, bucket.resetAt - t);
    await next();
  };
}

function tooMany(c: Context, retryAfterMs: number) {
  c.header("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return c.json({ error: "too_many_requests" }, 429);
}

/** Client address as the proxy reports it in cf-connecting-ip (Caddy sets it, or Cloudflare). Trusted only because the origin check rejects direct traffic. */
export function clientIp(c: Context): string {
  return c.req.header("cf-connecting-ip") ?? "local";
}

/** Limits from docs/PLAN.md §7, per client address. */
export const limits = {
  login: { limit: 5, windowMs: 60_000 },
  score: { limit: 20, windowMs: 60_000 },
  mcp: { limit: 60, windowMs: 60_000 },
} as const;
