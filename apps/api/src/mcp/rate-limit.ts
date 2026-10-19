import type { MiddlewareHandler } from "hono";

/**
 * Fixed-window limiter kept in memory. One owner and one process, so a single counter per
 * route is enough; it backs up the Cloudflare rule if someone reaches the server directly.
 */
export function rateLimit(limit: number, windowMs: number, now: () => number = Date.now): MiddlewareHandler {
  let windowStart = 0;
  let count = 0;
  return async (c, next) => {
    const t = now();
    if (t - windowStart >= windowMs) {
      windowStart = t;
      count = 0;
    }
    if (++count > limit) {
      c.header("Retry-After", String(Math.ceil((windowStart + windowMs - t) / 1000)));
      return c.json({ error: "rate_limited" }, 429);
    }
    await next();
  };
}
