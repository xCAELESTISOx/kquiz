import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { findLeeches } from "../leeches.js";
import { introduceDailyCards } from "../newCards.js";
import { RETENTION_RANGE, setDesiredRetention } from "../fsrs.js";
import { fsrsStatus } from "../fsrsOptimizer.js";
import { ratings } from "../review.js";
import { applyReviews, dueQueue, getStats } from "../reviewStore.js";

export const MAX_REVIEWS_PER_REQUEST = 200;

const mode = z.enum(["meaning", "speech", "listening"]);

const reviewSchema = z.object({
  id: z.uuid(),
  cardId: z.number().int().positive(),
  mode,
  rating: z.enum(Object.keys(ratings) as [keyof typeof ratings, ...(keyof typeof ratings)[]]),
  reviewedAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  elapsedMs: z.number().int().min(0).max(3_600_000).optional(),
});

export function reviewRoutes(db: Db, now: () => Date, timeZone: string) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/queue", (c) => {
    const query = z
      .object({ mode, limit: z.coerce.number().int().min(1).max(200).optional() })
      .safeParse(c.req.query());
    if (!query.success) return c.json({ error: "invalid_request", issues: query.error.issues }, 400);
    const userId = c.get("user").id;
    introduceDailyCards(db, userId, now(), timeZone);
    return c.json({ items: dueQueue(db, userId, query.data.mode, now(), query.data.limit) });
  });

  // Accepts a batch so the offline queue can flush in one request.
  app.post("/", async (c) => {
    const body = z
      .object({ reviews: z.array(reviewSchema).min(1).max(MAX_REVIEWS_PER_REQUEST) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    return c.json({ results: applyReviews(db, c.get("user").id, body.data.reviews, now()) });
  });

  app.get("/stats", (c) => {
    const userId = c.get("user").id;
    introduceDailyCards(db, userId, now(), timeZone);
    return c.json(getStats(db, userId, now(), timeZone));
  });

  // Cards forgotten again and again (leeches.ts), for the app's list; Claude gets them through get_leeches.
  app.get("/leeches", (c) => c.json({ items: findLeeches(db, c.get("user").id) }));

  app.get("/fsrs", (c) => c.json({ modes: fsrsStatus(db, c.get("user").id), retentionRange: RETENTION_RANGE }));

  // Target retention per mode: lower means fewer reviews a day and more forgotten cards.
  app.put("/fsrs", async (c) => {
    const body = z
      .object({ mode, desiredRetention: z.number().min(RETENTION_RANGE.min).max(RETENTION_RANGE.max) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    const userId = c.get("user").id;
    setDesiredRetention(db, userId, body.data.mode, Math.round(body.data.desiredRetention * 100) / 100);
    return c.json({ modes: fsrsStatus(db, userId), retentionRange: RETENTION_RANGE });
  });

  return app;
}
