import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { attempts, cards, phoneStats, reviewLog, reviewStates } from "./db/schema.js";
import { getFsrsSetup } from "./fsrs.js";
import { newCards } from "./newCards.js";
import type { ReviewMode } from "./review.js";
import { reviewable } from "./reviewStore.js";

const DAY = 86_400_000;
export const ACTIVITY_DAYS = 7 * 17;
export const FORECAST_DAYS = 30;
const RETENTION_DAYS = 30;
const SPEECH_WEEKS = 8;
const TREND_DAYS = 14;
// Reviews closer than this to the previous one are learning steps, not a test of memory.
const MIN_RECALL_GAP = 12 * 3_600_000;
// FSRS calls a card mature at three weeks between reviews, as Anki does.
const MATURE_DAYS = 21;
const MIN_SOUND_ATTEMPTS = 3;

/**
 * Counts per mode. Keys are whatever modes `review_states` holds, so a new mode shows up without
 * changing this file; the client labels the ones it knows.
 */
type ByMode<T> = Record<string, T>;

export type StatsOverview = {
  /** Local date (YYYY-MM-DD) in the client's time zone. */
  today: string;
  streak: { current: number; best: number; reviewedToday: boolean };
  /** Reviews per local day, oldest first, ending today. */
  activity: { day: string; reviews: number }[];
  /**
   * Reviews coming due per local day, today first; today includes everything overdue. Words still
   * in the new-word pool or being learned have no review states yet, so they are not counted; a
   * word just learned is (its first review is due the next day).
   */
  forecast: { day: string; due: ByMode<number>; words: number }[];
  /** Words (cards) already learned: past the new-word pool and not paused, as on Today. */
  learned: number;
  /** New words taken into "Learn" and not learned yet: they join the forecast once learned. */
  learning: number;
  /** Share of reviews in the last 30 days not rated "again", leaving out first sightings and learning steps. */
  retention: ByMode<{ reviews: number; recalled: number }>;
  /** Retention FSRS schedules for, per mode (set on the FSRS settings screen). */
  targetRetention: ByMode<number>;
  cards: { total: number; byMode: ByMode<{ new: number; learning: number; young: number; mature: number }> };
  speech: {
    /** Pronunciation attempts per week, oldest first, the last one ending today. */
    weeks: { start: string; attempts: number; avgScore: number | null }[];
    /** Sounds with the highest error rate overall, with the last two weeks against the two before. */
    sounds: {
      phone: string;
      attempts: number;
      errors: number;
      recent: { attempts: number; errors: number };
      previous: { attempts: number; errors: number };
    }[];
  };
};

/** Minutes east of UTC of an IANA time zone at `at` (540 for Asia/Seoul). */
export function zoneOffset(timeZone: string, at = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  );
  const local = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
  return Math.round((local - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** `tzOffsetMinutes` is minutes east of UTC (540 for Seoul), so days start at the owner's midnight. */
export function statsOverview(db: Db, userId: number, now = new Date(), tzOffsetMinutes = 0): StatsOverview {
  const shift = tzOffsetMinutes * 60_000;
  const dayOf = (ms: number) => Math.floor((ms + shift) / DAY);
  const dateOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
  const startOf = (day: number) => new Date(day * DAY - shift);
  const today = dayOf(now.getTime());
  const localDay = sql<number>`cast((${reviewLog.reviewedAt} + ${shift}) / ${DAY} as integer)`;
  const mine = eq(cards.userId, userId);

  // Streak: days with at least one review; it is still alive today until the day is over.
  const reviewDays = db
    .selectDistinct({ day: localDay })
    .from(reviewLog)
    .innerJoin(cards, eq(cards.id, reviewLog.cardId))
    .where(mine)
    .orderBy(desc(localDay))
    .limit(3660)
    .all()
    .map((r) => r.day);
  const { current, best } = streaks(reviewDays, today);

  const perDay = new Map(
    db
      .select({ day: localDay, n: sql<number>`count(*)` })
      .from(reviewLog)
      .innerJoin(cards, eq(cards.id, reviewLog.cardId))
      .where(and(mine, gte(reviewLog.reviewedAt, startOf(today - ACTIVITY_DAYS + 1))))
      .groupBy(localDay)
      .all()
      .map((r) => [r.day, r.n]),
  );
  const activity = Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
    const day = today - ACTIVITY_DAYS + 1 + i;
    return { day: dateOf(day), reviews: perDay.get(day) ?? 0 };
  });

  const dueDay = sql<number>`max(cast((${reviewStates.due} + ${shift}) / ${DAY} as integer), ${today})`;
  const forecast = Array.from({ length: FORECAST_DAYS }, (_, i) => ({ day: dateOf(today + i), due: {} as ByMode<number>, words: 0 }));
  // Every state belongs to a learned word (newCards.ts), so a "new" one (state 0) is a word just
  // learned, waiting for its first review: it counts like any other.
  const dueSoon = and(mine, reviewable, sql`${reviewStates.due} < ${startOf(today + FORECAST_DAYS).getTime()}`);
  // A word due in two modes on one day is still one word to go over.
  const wordRows = db
    .select({ day: dueDay, n: sql<number>`count(distinct ${reviewStates.cardId})` })
    .from(reviewStates)
    .innerJoin(cards, sql`${cards.id} = ${reviewStates.cardId}`)
    .where(dueSoon)
    .groupBy(dueDay)
    .all();
  const learned =
    db
      .select({ n: sql<number>`count(distinct ${reviewStates.cardId})` })
      .from(reviewStates)
      .innerJoin(cards, sql`${cards.id} = ${reviewStates.cardId}`)
      .where(and(mine, reviewable))
      .get()?.n ?? 0;
  const dueRows = db
    .select({ mode: reviewStates.mode, day: dueDay, n: sql<number>`count(*)` })
    .from(reviewStates)
    .innerJoin(cards, sql`${cards.id} = ${reviewStates.cardId}`)
    .where(dueSoon)
    .groupBy(reviewStates.mode, dueDay)
    .all();
  const modes = new Set<string>();
  const stateRows = db
    .select({
      mode: reviewStates.mode,
      state: reviewStates.state,
      mature: sql<number>`${reviewStates.scheduledDays} >= ${MATURE_DAYS}`,
      n: sql<number>`count(*)`,
    })
    .from(reviewStates)
    .innerJoin(cards, sql`${cards.id} = ${reviewStates.cardId}`)
    .where(and(mine, reviewable))
    .groupBy(reviewStates.mode, reviewStates.state, sql`3`)
    .all();
  const byMode: StatsOverview["cards"]["byMode"] = {};
  for (const { mode, state, mature, n } of stateRows) {
    modes.add(mode);
    const counts = (byMode[mode] ??= { new: 0, learning: 0, young: 0, mature: 0 });
    // ts-fsrs states: 0 new, 1 learning, 2 review, 3 relearning.
    if (state === 0) counts.new += n;
    else if (state === 2) counts[mature ? "mature" : "young"] += n;
    else counts.learning += n;
  }
  for (const entry of forecast) for (const mode of modes) entry.due[mode] = 0;
  for (const { mode, day, n } of dueRows) {
    const entry = forecast[day - today];
    if (entry) entry.due[mode] = (entry.due[mode] ?? 0) + n;
  }
  for (const { day, n } of wordRows) {
    const entry = forecast[day - today];
    if (entry) entry.words += n;
  }

  const retention: StatsOverview["retention"] = {};
  for (const mode of modes) retention[mode] = { reviews: 0, recalled: 0 };
  // Spelled out: drizzle leaves single-table columns unqualified, which would bind them to `p`.
  const previous = sql<number | null>`(
    select max(p.reviewed_at) from review_log p
    where p.card_id = review_log.card_id and p.mode = review_log.mode and p.reviewed_at < review_log.reviewed_at
  )`;
  const recallRows = db
    .select({ mode: reviewLog.mode, rating: reviewLog.rating, at: reviewLog.reviewedAt, previous })
    .from(reviewLog)
    .innerJoin(cards, eq(cards.id, reviewLog.cardId))
    .where(and(mine, gte(reviewLog.reviewedAt, new Date(now.getTime() - RETENTION_DAYS * DAY))))
    .all();
  for (const { mode, rating, at, previous: prev } of recallRows) {
    if (prev === null || at.getTime() - prev < MIN_RECALL_GAP) continue;
    const r = (retention[mode] ??= { reviews: 0, recalled: 0 });
    r.reviews += 1;
    if (rating !== "again") r.recalled += 1;
  }

  return {
    today: dateOf(today),
    streak: { current, best, reviewedToday: reviewDays[0] === today },
    activity,
    forecast,
    learned,
    learning: newCards(db, userId, now).learning,
    retention,
    targetRetention: Object.fromEntries([...modes].map((mode) => [mode, getFsrsSetup(db, userId, mode as ReviewMode).desiredRetention])),
    cards: { total: db.select({ n: sql<number>`count(*)` }).from(cards).where(mine).get()?.n ?? 0, byMode },
    speech: speechStats(db, userId, today, startOf, dateOf, dayOf),
  };
}

function speechStats(
  db: Db,
  userId: number,
  today: number,
  startOf: (day: number) => Date,
  dateOf: (day: number) => string,
  dayOf: (ms: number) => number,
): StatsOverview["speech"] {
  const firstWeekDay = today - SPEECH_WEEKS * 7 + 1;
  const rows = db
    .select({ at: attempts.createdAt, score: attempts.score, targetPhones: attempts.targetPhones, errors: attempts.errors })
    .from(attempts)
    .innerJoin(cards, eq(cards.id, attempts.cardId))
    .where(and(eq(cards.userId, userId), gte(attempts.createdAt, startOf(firstWeekDay))))
    .all();

  const weeks = Array.from({ length: SPEECH_WEEKS }, (_, i) => ({
    start: dateOf(firstWeekDay + i * 7),
    attempts: 0,
    total: 0,
  }));
  type Window = { attempts: number; errors: number };
  const recent = new Map<string, Window>();
  const previous = new Map<string, Window>();
  for (const row of rows) {
    const day = dayOf(row.at.getTime());
    const week = weeks[Math.floor((day - firstWeekDay) / 7)];
    if (week) {
      week.attempts += 1;
      week.total += row.score;
    }
    const age = today - day;
    const window = age < TREND_DAYS ? recent : age < 2 * TREND_DAYS ? previous : undefined;
    if (window) countPhones(window, row.targetPhones, row.errors);
  }

  // The same rule as recordAttempt: only "wrong" sounds are errors.
  const overall = db
    .select({ phone: phoneStats.phone, attempts: phoneStats.attempts, errors: phoneStats.errors })
    .from(phoneStats)
    .where(and(eq(phoneStats.userId, userId), gte(phoneStats.attempts, MIN_SOUND_ATTEMPTS), sql`${phoneStats.errors} > 0`))
    .orderBy(desc(sql`cast(${phoneStats.errors} as real) / ${phoneStats.attempts}`), desc(phoneStats.attempts))
    .limit(8)
    .all();

  return {
    weeks: weeks.map(({ start, attempts: n, total }) => ({
      start,
      attempts: n,
      avgScore: n ? Math.round(total / n) : null,
    })),
    sounds: overall.map((s) => ({
      ...s,
      recent: recent.get(s.phone) ?? { attempts: 0, errors: 0 },
      previous: previous.get(s.phone) ?? { attempts: 0, errors: 0 },
    })),
  };
}

function countPhones(into: Map<string, { attempts: number; errors: number }>, targetPhones: string[], errors: unknown[]) {
  const wrong = new Map<string, number>();
  for (const e of errors as { status?: string; expected?: { ipa?: string } | null }[]) {
    const ipa = e.status === "wrong" ? e.expected?.ipa : undefined;
    if (ipa) wrong.set(ipa, (wrong.get(ipa) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const phone of targetPhones) seen.set(phone, (seen.get(phone) ?? 0) + 1);
  for (const [phone, n] of seen) {
    const w = (into.get(phone) ?? { attempts: 0, errors: 0 }) as { attempts: number; errors: number };
    w.attempts += n;
    w.errors += Math.min(wrong.get(phone) ?? 0, n);
    into.set(phone, w);
  }
}

/** Current and longest runs of consecutive days; `days` is distinct and newest first. */
export function streaks(days: number[], today: number): { current: number; best: number } {
  let current = 0;
  let expected = days[0] === today ? today : today - 1;
  for (const day of days) {
    if (day !== expected) break;
    current += 1;
    expected -= 1;
  }
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i - 1]! - days[i]! === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return { current, best };
}
