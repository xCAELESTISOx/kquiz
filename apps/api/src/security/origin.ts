import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const ORIGIN_HEADER = "x-kquiz-origin";

/**
 * Rejects requests that did not pass through Cloudflare. Cloudflare adds a secret header
 * to every proxied request, so traffic sent straight to the server's IP lacks it.
 * This backs up the firewall that only admits Cloudflare's addresses.
 */
export function requireCloudflare(secret: string | undefined): MiddlewareHandler {
  if (!secret) return async (_c, next) => next();
  const expected = Buffer.from(secret);
  return async (c, next) => {
    const given = Buffer.from(c.req.header(ORIGIN_HEADER) ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return c.json({ error: "forbidden" }, 403);
    }
    // Cloudflare always sets it; without it per-client limits would collapse into one bucket.
    if (!c.req.header("cf-connecting-ip")) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}
