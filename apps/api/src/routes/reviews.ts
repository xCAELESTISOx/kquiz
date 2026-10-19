import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { introduceDailyCards } from "../newCards.js";
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
    introduceDailyCards(db, now(), timeZone);
    return c.json({ items: dueQueue(db, query.data.mode, now(), query.data.limit) });
  });

  // Accepts a batch so the offline queue can flush in one request.
  app.post("/", async (c) => {
    const body = z
      .object({ reviews: z.array(reviewSchema).min(1).max(MAX_REVIEWS_PER_REQUEST) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    return c.json({ results: applyReviews(db, body.data.reviews, now()) });
  });

  app.get("/stats", (c) => {
    introduceDailyCards(db, now(), timeZone);
    return c.json(getStats(db, now(), timeZone));
  });

  return app;
}
