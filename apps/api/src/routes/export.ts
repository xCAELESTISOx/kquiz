import { asc } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthVariables } from "../auth/sessions.js";
import { toCardDto } from "../cardStore.js";
import type { Db } from "../db/client.js";
import { attempts, cards, reviewLog, reviewStates } from "../db/schema.js";
import { getSettings } from "../settings.js";

export const EXPORT_VERSION = 1;

/** Everything the owner has put in, as one JSON file: cards with their schedules, review history, attempts. */
export function exportData(db: Db, now: Date) {
  const states = new Map<number, Omit<typeof reviewStates.$inferSelect, "cardId">[]>();
  for (const { cardId, ...state } of db.select().from(reviewStates).all()) {
    states.set(cardId, [...(states.get(cardId) ?? []), state]);
  }
  return {
    app: "kquiz",
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    settings: getSettings(db),
    cards: db
      .select()
      .from(cards)
      .orderBy(asc(cards.id))
      .all()
      .map((row) => ({
        ...toCardDto(row),
        introducedAt: row.introducedAt?.toISOString() ?? null,
        reviewStates: states.get(row.id) ?? [],
      })),
    reviewLog: db.select().from(reviewLog).orderBy(asc(reviewLog.reviewedAt)).all(),
    attempts: db.select().from(attempts).orderBy(asc(attempts.id)).all(),
  };
}

export function exportRoutes(db: Db, now: () => Date) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // A plain GET, so the app can offer it as a download link.
  app.get("/", (c) => {
    const at = now();
    c.header("content-disposition", `attachment; filename="kquiz-${at.toISOString().slice(0, 10)}.json"`);
    c.header("cache-control", "no-store");
    return c.json(exportData(db, at));
  });

  return app;
}
