// New words. A card doesn't enter reviews when it is added, from Claude or in the app: it waits in
// the pool until it is learned, so reviews never ask about a word not met yet. The app's session
// ("Learn", apps/web screens/Review.tsx) learns a few at a time (ACTIVE_WORDS), oldest first, with no
// daily cap: a word up the ladder makes room for the next at once, however many wait for their check:
// each climbs a ladder of LADDER_STEPS tasks (build it from syllables, pick it out by ear, write it
// from the translation), a miss taking it one step down. A word up the ladder frees its place
// for the next from the pool and waits CHECK_AFTER; then, in a later session, it is asked once more
// from its translation. Right, and it is learned: it enters reviews (FSRS), first due the next day.
// Wrong, and it goes one step down too: back among the words being learned on the ladder's last
// step, to be passed in that session and checked again later. The owner can also pull a card in by hand, unlearned.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cards, reviewStates, sessionLogs } from "./db/schema.js";
import { toCardDto, type CardDto } from "./cardStore.js";
import { withSimilar } from "./similar.js";
import { newReviewState, toStateRow, type ReviewMode } from "./review.js";

export const reviewModes: ReviewMode[] = ["meaning", "speech", "listening"];

/** How many new words are learned at once, on the ladder. */
export const ACTIVE_WORDS = 3;
/**
 * At most this many words are met for the first time in any two sessions in a row, "Another round"
 * included (the app keeps to it, apps/web lib/session.ts): a session meets only what the one before it
 * left of these (metLastSession), and Today says so. A word taken onto the ladder but not met yet waits.
 */
export const NEW_PER_SESSION = 2;
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
 * the words "Learn" comes to first (being learned, then the pool, oldest added first), for Today.
 */
export type NewCards = {
  queued: number;
  learning: number;
  next: string[];
  /** Of `learning`, on the ladder now or due for their check: what "Learn" goes on with. */
  started: number;
  /** How many new words from the pool the next session takes. */
  fresh: number;
  /** In the pool, not started. */
  pool: number;
};

const NEXT_PREVIEW = 12;

export function newCards(db: Db, userId: number, now = new Date()): NewCards {
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
  const c = counts(db, userId, now);
  // Words on the ladder not met yet are new to the next session as much as the pool is; it meets
  // only what the session before it left of NEW_PER_SESSION.
  const unmet =
    db
      .select({ n: sql<number>`count(*)` })
      .from(cards)
      .where(and(waiting(userId), isNotNull(cards.learningAt), isNull(cards.learnPassedAt), isNull(cards.learnMetAt), eq(cards.learnStep, 0)))
      .get()?.n ?? 0;
  const fresh = Math.min(unmet + room(c), Math.max(0, NEW_PER_SESSION - metLastSession(db, userId)));
  const started = c.active - unmet + c.checks;
  // What "Learn" comes to: the words started (ladder, then checks), then the new ones it will take.
  const next = db
    .select({ korean: cards.korean })
    .from(cards)
    .where(and(waiting(userId), or(isNotNull(cards.learningAt), and(isNotNull(cards.learnPassedAt), lte(cards.learnPassedAt, checkTime(now))))))
    .orderBy(sql`case when ${cards.learningAt} is not null then 0 else 1 end`, asc(cards.id))
    .limit(NEXT_PREVIEW)
    .all()
    .concat(
      db
        .select({ korean: cards.korean })
        .from(cards)
        .where(and(waiting(userId), isNull(cards.learningAt), isNull(cards.learnPassedAt)))
        .orderBy(...poolOrder)
        .limit(Math.max(0, fresh - unmet))
        .all(),
    )
    .slice(0, NEXT_PREVIEW)
    .map((row) => row.korean);
  return { queued, learning, next, started, fresh, pool: c.pool };
}

/** How many of the latest "Learn" sessions are looked through for the last one that did anything. */
const LOOK_BACK = 20;

/**
 * How many new words the last "Learn" session met (not `current`, the one asking): the words it
 * showed as new (its log, sessionLogs.ts), less the ones put off with "Not now", and the words first
 * answered on their ladder since it began (cards.learnMetAt), in case the end of its log was lost.
 * A session left before its first task doesn't count as one. 0 when there was none.
 */
export function metLastSession(db: Pick<Db, "select">, userId: number, current?: string): number {
  const last = db
    .select()
    .from(sessionLogs)
    .where(and(eq(sessionLogs.userId, userId), current ? ne(sessionLogs.id, current) : undefined))
    .orderBy(desc(sessionLogs.startedAt))
    .limit(LOOK_BACK)
    .all()
    .find((row) => {
      const data = row.data as { screen?: unknown; tasks?: unknown };
      return data.screen === "learn" && Array.isArray(data.tasks) && data.tasks.length > 0;
    });
  if (!last) return 0;
  const met = new Set<number>();
  for (const task of (last.data as { tasks: Record<string, unknown>[] }).tasks) {
    const id = (task.card as { id?: unknown } | undefined)?.id;
    if (task.learn !== "intro" || typeof id !== "number") continue;
    const putOff = task.result === "skipped" && Array.isArray(task.answers) && task.answers.some((a) => (a as { note?: unknown }).note === "not now");
    if (!putOff) met.add(id);
  }
  for (const row of db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.userId, userId), gte(cards.learnMetAt, last.startedAt)))
    .all())
    met.add(row.id);
  return met.size;
}

/**
 * The pool's order: oldest added first (the tutor's lessons in turn), except that a word skipped as
 * it was met goes to the back, behind every word added before it was skipped.
 */
const poolOrder = [sql`coalesce(${cards.skippedAt}, ${cards.createdAt})`, asc(cards.id)];

const checkTime = (now: Date) => new Date(now.getTime() - CHECK_AFTER);

type Counts = { active: number; passed: number; checks: number; pool: number };

/** Unfinished words: on the ladder, up it and waiting (and of those, due for their check), and the pool. */
function counts(db: Pick<Db, "select">, userId: number, now: Date): Counts {
  const n = (where: ReturnType<typeof and>) =>
    db.select({ n: sql<number>`count(*)` }).from(cards).where(where).get()?.n ?? 0;
  return {
    active: n(and(waiting(userId), isNotNull(cards.learningAt), isNull(cards.learnPassedAt))),
    passed: n(and(waiting(userId), isNotNull(cards.learnPassedAt))),
    checks: n(and(waiting(userId), isNotNull(cards.learnPassedAt), lte(cards.learnPassedAt, checkTime(now)))),
    pool: n(and(waiting(userId), isNull(cards.learningAt), isNull(cards.learnPassedAt))),
  };
}

/**
 * How many new words may start now: the free places on the ladder. Words waiting for their check
 * don't hold new ones back (the owner learns as many as they like in a day); their checks come first in a session.
 */
export function room(c: Counts): number {
  return Math.max(0, Math.min(ACTIVE_WORDS - c.active, c.pool));
}

/**
 * A word being learned: the ladder step it is on (0 to LADDER_STEPS - 1), or "check" once it waited.
 * `met`: it has been answered on its ladder before, so on step 0 again it is built, not met as new.
 */
export type LearningItem = { card: CardDto; step: number | "check"; met?: boolean };

/** How many words ahead in the pool a session looks for pictures to fetch early: more than a long session meets. */
const UPCOMING = 12;

const waiting = (userId: number) =>
  and(eq(cards.userId, userId), isNull(cards.introducedAt), eq(cards.suspended, false));

/**
 * The new words for a session: the ones due for their check, then the ones being learned, and new
 * ones from the pool (oldest added first) only where there is room for them. `pool` is how many more wait after them.
 */
export function learningWords(
  db: Db,
  userId: number,
  now: Date,
  session?: string,
): { items: LearningItem[]; pool: number; upcoming: string[]; newLeft: number } {
  return db.transaction((tx) => {
    const checks = tx
      .select()
      .from(cards)
      .where(and(waiting(userId), isNotNull(cards.learnPassedAt), lte(cards.learnPassedAt, checkTime(now))))
      .orderBy(asc(cards.learnPassedAt))
      .all();
    const active = tx
      .select()
      .from(cards)
      .where(and(waiting(userId), isNotNull(cards.learningAt), isNull(cards.learnPassedAt)))
      .orderBy(asc(cards.learningAt), asc(cards.id))
      .all();
    const free = room(counts(tx, userId, now));
    if (free > 0) active.push(...pick(tx as unknown as Db, userId, free, now));
    const pool =
      tx
        .select({ n: sql<number>`count(*)` })
        .from(cards)
        .where(and(waiting(userId), isNull(cards.learningAt), isNull(cards.learnPassedAt)))
        .get()?.n ?? 0;
    const items = [
      ...checks.map((row): LearningItem => ({ card: toCardDto(row), step: "check" })),
      ...active.map((row): LearningItem => ({
        card: toCardDto(row),
        step: Math.min(row.learnStep, LADDER_STEPS - 1),
        ...(row.learnMetAt ? { met: true } : {}),
      })),
    ];
    withSimilar(tx as unknown as Db, userId, items.map((i) => i.card));
    // Pictures of the words that join next from the pool, so the app can fetch them before they are met.
    const upcoming = tx
      .select()
      .from(cards)
      .where(and(waiting(userId), isNull(cards.learningAt), isNull(cards.learnPassedAt)))
      .orderBy(...poolOrder)
      .limit(UPCOMING)
      .all()
      .flatMap((row) => toCardDto(row).picture?.url ?? []);
    // What this session may still meet as new, after the session before it.
    const newLeft = Math.max(0, NEW_PER_SESSION - metLastSession(tx, userId, session));
    return { items, pool, upcoming, newLeft };
  });
}

/** Takes the next `n` words from the pool (oldest added first) into learning, `except` one just skipped. */
function pick(tx: Db, userId: number, n: number, now: Date, except?: number) {
  const rows = tx
    .select()
    .from(cards)
    .where(and(waiting(userId), isNull(cards.learningAt), isNull(cards.learnPassedAt), except === undefined ? undefined : ne(cards.id, except)))
    .orderBy(...poolOrder)
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
      tx.update(cards).set({ learnStep: step, learnPassedAt: null, learningAt: row.learningAt ?? now, learnMetAt: row.learnMetAt ?? now }).where(where).run();
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
      tx.update(cards).set({ learnStep: step, learningAt: row.learningAt ?? now, learnMetAt: row.learnMetAt ?? now }).where(where).run();
      return { status: "climbed", step };
    }
    tx.update(cards).set({ learnStep: step, learnPassedAt: now, learningAt: null, learnMetAt: row.learnMetAt ?? now }).where(where).run();
    // Its place on the ladder goes to the next new word.
    const [next] = room(counts(tx, userId, now)) > 0 ? pick(tx as unknown as Db, userId, 1, now) : [];
    return { status: "passed", next: next ? { card: withSimilar(tx as unknown as Db, userId, [toCardDto(next)])[0]!, step: 0 } : null };
  });
}

export type SkipAnswer = { status: "skipped"; next: LearningItem | null } | { status: "not_new" } | { status: "not_found" };

/**
 * "Not now" on a word just met: it goes back to the pool, at its very end, and the next word from
 * the pool takes its place (`next`, none when it was the last). Only a word not yet started up the
 * ladder can be skipped; one partly learned stays where it is.
 */
export function skipLearning(db: Db, userId: number, id: number, now: Date): SkipAnswer {
  return db.transaction((tx) => {
    const row = tx.select().from(cards).where(and(eq(cards.id, id), eq(cards.userId, userId))).get();
    if (!row) return { status: "not_found" };
    if (row.introducedAt || row.learnPassedAt || row.learnStep > 0 || row.learnMetAt) return { status: "not_new" };
    tx.update(cards).set({ learningAt: null, learnStep: 0, skippedAt: now }).where(eq(cards.id, id)).run();
    const [next] = room(counts(tx, userId, now)) > 0 ? pick(tx as unknown as Db, userId, 1, now, id) : [];
    return { status: "skipped", next: next ? { card: withSimilar(tx as unknown as Db, userId, [toCardDto(next)])[0]!, step: 0 } : null };
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
