// New words. A card doesn't enter reviews when it is added: it waits here until it has been learned
// ("Учить", apps/web screens/Learn.tsx), so reviews never ask about a word not met yet. Words come
// in lessons: the cards added on one day (in the owner's time zone) are one portion, the way a
// tutor hands out a set of words per lesson, and the lessons are learned oldest first. A learned
// word gets its schedule then, first due the next day, or a little later today if it was missed.
// The owner can also pull a card in by hand, unlearned.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cards, reviewStates } from "./db/schema.js";
import { newReviewState, toStateRow, type ReviewMode } from "./review.js";

export const reviewModes: ReviewMode[] = ["meaning", "speech", "listening"];

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

/** `now`'s date in `timeZone`, as YYYY-MM-DD: the lesson a card added then belongs to. */
export function localDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Where a YYYY-MM-DD day in `timeZone` starts and ends. */
export function dayRange(day: string, timeZone: string): { start: Date; end: Date } {
  // Noon UTC falls on the same date in every zone within ±12 hours.
  const start = startOfDay(new Date(`${day}T12:00:00Z`), timeZone);
  const end = startOfDay(new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000), timeZone);
  return { start, end };
}

const HOUR = 3_600_000;
/** A word missed while learning comes back this much later the same day (or at midnight, if sooner). */
export const SHAKY_DELAY = 2 * HOUR;

/** Puts cards into reviews with fresh schedules in every mode, due at `due` (now by default). */
export function introduce(tx: Tx, ids: number[], how: "direct" | "daily" | "early" | "learned", now: Date, due = now) {
  if (!ids.length) return;
  tx.update(cards).set({ introducedAt: now, introduction: how }).where(inArray(cards.id, ids)).run();
  const state = toStateRow({ ...newReviewState(now), due });
  tx.insert(reviewStates)
    .values(ids.flatMap((cardId) => reviewModes.map((mode) => ({ cardId, mode, ...state }))))
    .onConflictDoNothing()
    .run();
}

export type Lesson = { day: string; count: number };
export type NewCards = { queued: number; lessons: Lesson[] };

/** The words waiting to be learned, by lesson, oldest first. Paused cards wait out of the lessons. */
export function newCards(db: Db, userId: number, timeZone: string): NewCards {
  const rows = db
    .select({ createdAt: cards.createdAt, suspended: cards.suspended })
    .from(cards)
    .where(and(eq(cards.userId, userId), isNull(cards.introducedAt)))
    .orderBy(asc(cards.createdAt), asc(cards.id))
    .all();
  const lessons: Lesson[] = [];
  for (const row of rows) {
    if (row.suspended) continue;
    const day = localDay(row.createdAt, timeZone);
    const last = lessons.at(-1);
    if (last?.day === day) last.count++;
    else lessons.push({ day, count: 1 });
  }
  return { queued: rows.length, lessons };
}

/**
 * Takes words just learned into reviews: due at the start of the next day, or `SHAKY_DELAY` from now
 * for the ones missed on the way (never later than that midnight). Cards already in reviews are left
 * as they are, so learning a group again changes nothing. Returns the ids taken in.
 */
export function introduceLearned(db: Db, userId: number, ids: number[], shaky: number[], now: Date, timeZone: string): number[] {
  return db.transaction((tx) => {
    const queued = ids.length
      ? tx
          .select({ id: cards.id })
          .from(cards)
          .where(and(eq(cards.userId, userId), isNull(cards.introducedAt), inArray(cards.id, ids)))
          .all()
          .map((row) => row.id)
      : [];
    const missed = new Set(shaky);
    const tomorrow = new Date(startOfDay(now, timeZone).getTime() + 24 * HOUR);
    // DST can make a day 23 or 25 hours long; the next midnight is what matters.
    const nextDay = startOfDay(new Date(tomorrow.getTime() + 2 * HOUR), timeZone);
    const later = new Date(Math.min(now.getTime() + SHAKY_DELAY, nextDay.getTime()));
    introduce(tx, queued.filter((id) => !missed.has(id)), "learned", now, nextDay);
    introduce(tx, queued.filter((id) => missed.has(id)), "learned", now, later);
    return queued;
  });
}

/** Pulls one queued card into reviews now, without learning it first. */
export function introduceEarly(db: Db, userId: number, id: number, now: Date): "introduced" | "not_queued" | "not_found" {
  return db.transaction((tx) => {
    const row = tx
      .select({ introducedAt: cards.introducedAt })
      .from(cards)
      .where(and(eq(cards.id, id), eq(cards.userId, userId)))
      .get();
    if (!row) return "not_found";
    if (row.introducedAt) return "not_queued";
    introduce(tx, [id], "early", now);
    return "introduced";
  });
}
