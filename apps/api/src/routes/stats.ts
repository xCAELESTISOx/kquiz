import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { statsOverview } from "../statsStore.js";

/** GET /api/stats?tz=540: the statistics screen; `tz` is the client's offset in minutes east of UTC. */
export function statsRoutes(db: Db, now: () => Date) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", (c) => {
    const query = z.object({ tz: z.coerce.number().int().min(-720).max(840).default(0) }).safeParse(c.req.query());
    if (!query.success) return c.json({ error: "invalid_request", issues: query.error.issues }, 400);
    return c.json(statsOverview(db, now(), query.data.tz));
  });

  return app;
}
