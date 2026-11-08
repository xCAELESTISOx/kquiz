// New words. A card doesn't enter reviews when it is added, from Claude or in the app: it waits in
// the pool until it is learned, so reviews never ask about a word not met yet. The app's session
// ("Учить", apps/web screens/Review.tsx) learns a few at a time (ACTIVE_WORDS), oldest first:
// each climbs a ladder of LADDER_STEPS tasks (build it from syllables, pick it out by ear, write it
// from the translation), a miss taking it one step down. A word up the ladder frees its place
// for the next from the pool and waits CHECK_AFTER; then, in a later session, it is asked once more
// from its translation. Right, and it is learned: it enters reviews (FSRS), first due the next day.
// Wrong, and it goes one step down too: back among the words being learned on the ladder's last
// step, to be passed in that session and checked again later. The owner can also pull a card in by hand, unlearned.
import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cards, reviewStates } from "./db/schema.js";
import { toCardDto, type CardDto } from "./cardStore.js";
import { withSimilar } from "./similar.js";
import { newReviewState, toStateRow, type ReviewMode } from "./review.js";

export const reviewModes: ReviewMode[] = ["meaning", "speech", "listening"];

/** How many new words are learned at once. */
export const ACTIVE_WORDS = 5;
/** Tasks in a row a word climbs in a session before it waits for its check. */
export const LADDER_STEPS = 3;
/** How long a word up the ladder waits before it is checked, so the check is from memory. */
export const CHECK_AFTER = 3 * 3_600_000;

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

/**
 * New words not learned yet. `queued`: all of them (in the pool, being learned, or waiting for
 * their check). `learning`: of those, the ones already taken into learning. `next`: the Korean of
 * the words "Учить" comes to first (being learned, then the pool, oldest added first), for Today.
 */
export type NewCards = { queued: number; learning: number; next: string[] };

const NEXT_PREVIEW = 12;

export function newCards(db: Db, userId: number): NewCards {
  const queued =
    db
      .select({ n: sql<number>`count(*)` })
      .from(cards)
      .where(and(eq(cards.userId, userId), isNull(cards.introducedAt)))
      .get()?.n ?? 0;
  const taken = sql`(${cards.learningAt} is not null or ${cards.learnPassedAt} is not null)`;
  const learning =
    db
      .select({ n: sql<number>`count(*)` })
      .from(cards)
      .where(and(waiting(userId), taken))
      .get()?.n ?? 0;
  const next = db
    .select({ korean: cards.korean })
    .from(cards)
    .where(waiting(userId))
    .orderBy(sql`case when ${taken} then 0 else 1 end`, asc(cards.id))
    .limit(NEXT_PREVIEW)
    .all()
    .map((row) => row.korean);
  return { queued, learning, next };
}

/** A word being learned: the ladder step it is on (0 to LADDER_STEPS - 1), or "check" once it waited. */
export type LearningItem = { card: CardDto; step: number | "check" };

const waiting = (userId: number) =>
  and(eq(cards.userId, userId), isNull(cards.introducedAt), eq(cards.suspended, false));

/**
 * The new words for a session: the ones due for their check, then the ones being learned, filled up
 * to ACTIVE_WORDS from the pool, oldest added first. `pool` is how many more wait after them.
 */
export function learningWords(db: Db, userId: number, now: Date): { items: LearningItem[]; pool: number } {
  return db.transaction((tx) => {
    const checks = tx
      .select()
      .from(cards)
      .where(and(waiting(userId), isNotNull(cards.learnPassedAt), lte(cards.learnPassedAt, new Date(now.getTime() - CHECK_AFTER))))
      .orderBy(asc(cards.learnPassedAt))
      .all();
    const active = tx
      .select()
      .from(cards)
      .where(and(waiting(userId), isNotNull(cards.learningAt), isNull(cards.learnPassedAt)))
      .orderBy(asc(cards.learningAt), asc(cards.id))
      .all();
    if (active.length < ACTIVE_WORDS) {
      const fresh = pick(tx as unknown as Db, userId, ACTIVE_WORDS - active.length, now);
      active.push(...fresh);
    }
    const pool =
      tx
        .select({ n: sql<number>`count(*)` })
        .from(cards)
        .where(and(waiting(userId), isNull(cards.learningAt), isNull(cards.learnPassedAt)))
        .get()?.n ?? 0;
    const items = [
      ...checks.map((row): LearningItem => ({ card: toCardDto(row), step: "check" })),
      ...active.map((row): LearningItem => ({ card: toCardDto(row), step: Math.min(row.learnStep, LADDER_STEPS - 1) })),
    ];
    withSimilar(tx as unknown as Db, userId, items.map((i) => i.card));
    return { items, pool };
  });
}

/** Takes the next `n` words from the pool (oldest added first) into learning. */
function pick(tx: Db, userId: number, n: number, now: Date) {
  const rows = tx
    .select()
    .from(cards)
    .where(and(waiting(userId), isNull(cards.learningAt), isNull(cards.learnPassedAt)))
    .orderBy(asc(cards.createdAt), asc(cards.id))
    .limit(n)
    .all();
  if (rows.length)
    tx.update(cards)
      .set({ learningAt: now, learnStep: 0 })
      .where(inArray(cards.id, rows.map((r) => r.id)))
      .run();
  return rows.map((row) => ({ ...row, learningAt: now, learnStep: 0 }));
}

export type LearnAnswer =
  | { status: "climbed"; step: number }
  | { status: "missed"; step: number }
  | { status: "passed"; next: LearningItem | null }
  | { status: "learned"; due: string }
  | { status: "not_queued" }
  | { status: "not_found" };

/**
 * One answer for a word being learned. Up the ladder a step, or one step down on a miss; at the top
 * it waits for its check and the next word from the pool takes its place (`next`). Its check right,
 * it enters reviews, due at the next midnight; wrong, it is back on the ladder's last step.
 */
export function answerLearning(db: Db, userId: number, id: number, ok: boolean, now: Date, timeZone: string): LearnAnswer {
  return db.transaction((tx) => {
    const row = tx.select().from(cards).where(and(eq(cards.id, id), eq(cards.userId, userId))).get();
    if (!row) return { status: "not_found" };
    if (row.introducedAt) return { status: "not_queued" };
    const where = eq(cards.id, id);
    if (!ok) {
      // One step down, never back to the bottom: a missed check goes back to the ladder's last step.
      const step = row.learnPassedAt ? LADDER_STEPS - 1 : Math.max(row.learnStep - 1, 0);
      tx.update(cards).set({ learnStep: step, learnPassedAt: null, learningAt: row.learningAt ?? now }).where(where).run();
      return { status: "missed", step };
    }
    if (row.learnPassedAt) {
      const due = nextMidnight(now, timeZone);
      tx.update(cards).set({ learningAt: null, learnStep: 0, learnPassedAt: null }).where(where).run();
      introduce(tx, [id], "learned", now, due);
      return { status: "learned", due: due.toISOString() };
    }
    const step = row.learnStep + 1;
    if (step < LADDER_STEPS) {
      tx.update(cards).set({ learnStep: step, learningAt: row.learningAt ?? now }).where(where).run();
      return { status: "climbed", step };
    }
    tx.update(cards).set({ learnStep: step, learnPassedAt: now, learningAt: null }).where(where).run();
    const [next] = pick(tx as unknown as Db, userId, 1, now);
    return { status: "passed", next: next ? { card: withSimilar(tx as unknown as Db, userId, [toCardDto(next)])[0]!, step: 0 } : null };
  });
}

function nextMidnight(now: Date, timeZone: string): Date {
  const tomorrow = new Date(startOfDay(now, timeZone).getTime() + 24 * HOUR);
  // DST can make a day 23 or 25 hours long; the next midnight is what matters.
  return startOfDay(new Date(tomorrow.getTime() + 2 * HOUR), timeZone);
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
    const nextDay = nextMidnight(now, timeZone);
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
