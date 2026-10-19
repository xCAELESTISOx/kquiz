import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { statsOverview, zoneOffset } from "../statsStore.js";

/**
 * GET /api/stats?tz=540: the statistics screen; `tz` is the client's offset in minutes east of UTC,
 * the server's TIME_ZONE when left out.
 */
export function statsRoutes(db: Db, now: () => Date, timeZone = "UTC") {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", (c) => {
    const query = z.object({ tz: z.coerce.number().int().min(-720).max(840).optional() }).safeParse(c.req.query());
    if (!query.success) return c.json({ error: "invalid_request", issues: query.error.issues }, 400);
    const at = now();
    return c.json(statsOverview(db, at, query.data.tz ?? zoneOffset(timeZone, at)));
  });

  return app;
}
