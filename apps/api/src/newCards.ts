// The new-card queue. Cards from Claude don't enter reviews at once: they wait here and come in
// a few a day (settings.newPerDay), picked at random, so a batch of 60 words doesn't land in one
// morning and then return as an avalanche of reviews. Cards added in the app skip the queue, and
// the owner can pull any queued card in early without using up the day's allowance.
import { and, count, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cards, reviewStates } from "./db/schema.js";
import { newReviewState, toStateRow, type ReviewMode } from "./review.js";
import { getSettings } from "./settings.js";

export const reviewModes: ReviewMode[] = ["meaning", "speech"];

type Tx = Pick<Db, "insert" | "update">;

/** Midnight of `now`'s day in `timeZone`. */
export function startOfDay(now: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const wallClock = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  const offset = wallClock - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(parts.year!, parts.month! - 1, parts.day!) - offset);
}

/** Puts cards into reviews: fresh schedules in both modes, due now. */
export function introduce(tx: Tx, ids: number[], how: "direct" | "daily" | "early", now: Date) {
  if (!ids.length) return;
  tx.update(cards).set({ introducedAt: now, introduction: how }).where(inArray(cards.id, ids)).run();
  const state = toStateRow(newReviewState(now));
  tx.insert(reviewStates)
    .values(ids.flatMap((cardId) => reviewModes.map((mode) => ({ cardId, mode, ...state }))))
    .onConflictDoNothing()
    .run();
}

export type NewCardsToday = { introduced: number; limit: number; queued: number };

export function newCardsToday(db: Db, now: Date, timeZone: string): NewCardsToday {
  const introduced =
    db
      .select({ n: count() })
      .from(cards)
      .where(and(eq(cards.introduction, "daily"), gte(cards.introducedAt, startOfDay(now, timeZone))))
      .get()?.n ?? 0;
  const queued = db.select({ n: count() }).from(cards).where(isNull(cards.introducedAt)).get()?.n ?? 0;
  return { introduced, limit: getSettings(db).newPerDay, queued };
}

/**
 * Moves today's share of the queue into reviews, at random. Called before the queue or stats are
 * read, so there is no timer: the day's cards arrive the first time the app is opened that day.
 * Paused cards stay in the queue.
 */
export function introduceDailyCards(db: Db, now: Date, timeZone: string): number {
  return db.transaction((tx) => {
    const today = newCardsToday(tx as unknown as Db, now, timeZone);
    const room = today.limit - today.introduced;
    if (room <= 0 || today.queued === 0) return 0;
    const ids = tx
      .select({ id: cards.id })
      .from(cards)
      .where(and(isNull(cards.introducedAt), eq(cards.suspended, false)))
      .orderBy(sql`random()`)
      .limit(room)
      .all()
      .map((row) => row.id);
    introduce(tx, ids, "daily", now);
    return ids.length;
  });
}

/** Pulls one queued card into reviews now; it doesn't count against the daily allowance. */
export function introduceEarly(db: Db, id: number, now: Date): "introduced" | "not_queued" | "not_found" {
  return db.transaction((tx) => {
    const row = tx.select({ introducedAt: cards.introducedAt }).from(cards).where(eq(cards.id, id)).get();
    if (!row) return "not_found";
    if (row.introducedAt) return "not_queued";
    introduce(tx, [id], "early", now);
    return "introduced";
  });
}
