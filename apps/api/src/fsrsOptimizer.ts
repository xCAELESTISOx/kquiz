import { computeParameters, FSRSBinding, FSRSBindingItem, FSRSBindingReview } from "@open-spaced-repetition/binding";
import { and, asc, count, eq } from "drizzle-orm";
import { createEmptyCard, type Card } from "ts-fsrs";
import type { Db } from "./db/client.js";
import { fsrsSettings, reviewLog, reviewStates } from "./db/schema.js";
import { currentWeights, getFsrsSetup, schedulerFor } from "./fsrs.js";
import { reviewModes } from "./cardStore.js";
import { applyRating, ratings, type RatingName, type ReviewMode } from "./review.js";

/** The FSRS authors suggest about this many reviews before personal weights beat the defaults. */
export const MIN_REVIEWS = 1000;
/** Weights are refitted at most this often, and only when there are new reviews. */
export const REFIT_AFTER_MS = 30 * 86_400_000;
/** Like Anki, a review day starts at 4 am, so a late-night session counts as the same day. */
const DAY_STARTS_AT_HOUR = 4;

export type LoggedReview = { cardId: number; rating: RatingName; reviewedAt: Date };

/** Day number of an instant in `timeZone`, with days starting at 4 am local time. */
export function reviewDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const localMidnight = Date.UTC(part("year"), part("month") - 1, part("day"));
  return Math.floor(localMidnight / 86_400_000) - (part("hour") < DAY_STARTS_AT_HOUR ? 1 : 0);
}

/**
 * Training items in the shape fsrs-rs expects: for every review after a card's first, the card's
 * history up to and including it, with days between reviews. Only items that end on a later day
 * than the review before are kept: a same-day repeat says nothing about long-term memory, and
 * fsrs-rs rejects such items when evaluating.
 */
export function trainingItems(logs: LoggedReview[], timeZone: string): FSRSBindingItem[] {
  const byCard = new Map<number, LoggedReview[]>();
  for (const log of logs) {
    const list = byCard.get(log.cardId);
    if (list) list.push(log);
    else byCard.set(log.cardId, [log]);
  }
  const items: FSRSBindingItem[] = [];
  for (const history of byCard.values()) {
    history.sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());
    const days = history.map((r) => reviewDay(r.reviewedAt, timeZone));
    const reviews = history.map((r, i) => new FSRSBindingReview(ratings[r.rating], i === 0 ? 0 : days[i]! - days[i - 1]!));
    for (let i = 1; i < reviews.length; i++) {
      if (reviews[i]!.deltaT > 0) items.push(new FSRSBindingItem(reviews.slice(0, i + 1)));
    }
  }
  return items;
}

export type OptimizeResult =
  | { status: "not_enough_reviews"; reviews: number }
  | { status: "up_to_date"; reviews: number }
  | { status: "kept"; reviews: number; logLoss: number; candidateLogLoss: number }
  | { status: "updated"; reviews: number; logLoss: number; previousLogLoss: number }
  | { status: "failed"; reviews: number; error: string };

function modeLogs(db: Pick<Db, "select">, mode: ReviewMode): LoggedReview[] {
  return db
    .select({ cardId: reviewLog.cardId, rating: reviewLog.rating, reviewedAt: reviewLog.reviewedAt })
    .from(reviewLog)
    .where(eq(reviewLog.mode, mode))
    .orderBy(asc(reviewLog.reviewedAt))
    .all();
}

/**
 * Fits FSRS weights to the owner's history in one mode, once there is enough of it. New weights
 * are kept only if they predict that same history better than the current ones; then every
 * card's memory state is replayed with them so the next intervals use them from the start.
 */
export async function optimizeMode(
  db: Db,
  mode: ReviewMode,
  { timeZone, now = new Date(), force = false }: { timeZone: string; now?: Date; force?: boolean },
): Promise<OptimizeResult> {
  const reviews = db.select({ n: count() }).from(reviewLog).where(eq(reviewLog.mode, mode)).get()?.n ?? 0;
  if (reviews < MIN_REVIEWS) return { status: "not_enough_reviews", reviews };
  const row = db.select().from(fsrsSettings).where(eq(fsrsSettings.mode, mode)).get();
  const fresh = row?.checkedAt && now.getTime() - row.checkedAt.getTime() < REFIT_AFTER_MS;
  if (!force && (fresh || row?.checkedOnReviews === reviews)) return { status: "up_to_date", reviews };

  const logs = modeLogs(db, mode);
  const items = trainingItems(logs, timeZone);
  const setup = getFsrsSetup(db, mode);
  const checked = { checkedAt: now, checkedOnReviews: reviews };
  let candidate: number[], logLoss: number, previousLogLoss: number;
  try {
    candidate = await computeParameters(items, { enableShortTerm: true });
    previousLogLoss = new FSRSBinding(currentWeights(setup)).evaluate(items).logLoss;
    logLoss = new FSRSBinding(candidate).evaluate(items).logLoss;
  } catch (err) {
    // Usually too few long-term reviews; the defaults stay, and the next try is a month away.
    db.insert(fsrsSettings).values({ mode, ...checked }).onConflictDoUpdate({ target: fsrsSettings.mode, set: checked }).run();
    return { status: "failed", reviews, error: (err as Error).message };
  }
  const better = candidate.every(Number.isFinite) && logLoss < previousLogLoss;

  db.transaction((tx) => {
    const set = better ? { ...checked, weights: candidate, trainedOnReviews: reviews, optimizedAt: now } : checked;
    tx.insert(fsrsSettings)
      .values({ mode, ...set })
      .onConflictDoUpdate({ target: fsrsSettings.mode, set })
      .run();
    // Re-read: reviews made while the fit was running must be replayed too.
    if (better) replayMemoryStates(tx, mode, modeLogs(tx, mode), { ...setup, weights: candidate });
  });
  return better
    ? { status: "updated", reviews, logLoss, previousLogLoss }
    : { status: "kept", reviews, logLoss: previousLogLoss, candidateLogLoss: logLoss };
}

/**
 * Recomputes stability and difficulty from each card's history under new weights. Due dates stay
 * as they are, as in Anki: the change shows from each card's next review on.
 */
function replayMemoryStates(
  tx: Pick<Db, "update">,
  mode: ReviewMode,
  logs: LoggedReview[],
  setup: Parameters<typeof schedulerFor>[0],
) {
  const scheduler = schedulerFor(setup, false);
  const cards = new Map<number, Card>();
  for (const log of logs) {
    const card = cards.get(log.cardId) ?? createEmptyCard<Card>(log.reviewedAt);
    cards.set(log.cardId, applyRating(card, log.rating, log.reviewedAt, scheduler));
  }
  for (const [cardId, card] of cards) {
    tx.update(reviewStates)
      .set({ stability: card.stability, difficulty: card.difficulty })
      .where(and(eq(reviewStates.cardId, cardId), eq(reviewStates.mode, mode)))
      .run();
  }
}

export type FsrsStatus = {
  mode: ReviewMode;
  desiredRetention: number;
  /** True once the schedule uses weights fitted to the owner's history. */
  personal: boolean;
  reviews: number;
  minReviews: number;
  trainedOnReviews: number | null;
  optimizedAt: string | null;
};

export function fsrsStatus(db: Db): FsrsStatus[] {
  return reviewModes.map((mode) => {
    const row = db.select().from(fsrsSettings).where(eq(fsrsSettings.mode, mode)).get();
    const reviews = db.select({ n: count() }).from(reviewLog).where(eq(reviewLog.mode, mode)).get()?.n ?? 0;
    return {
      mode,
      desiredRetention: getFsrsSetup(db, mode).desiredRetention,
      personal: Boolean(row?.weights),
      reviews,
      minReviews: MIN_REVIEWS,
      trainedOnReviews: row?.weights ? (row.trainedOnReviews ?? null) : null,
      optimizedAt: row?.weights ? (row.optimizedAt?.toISOString() ?? null) : null,
    };
  });
}

/** Checks every mode now and then; the fit itself runs off the event loop in fsrs-rs. */
export function optimizerWorker(db: Db, timeZone: string, now: () => Date = () => new Date()) {
  let running = false;
  async function runOnce() {
    if (running) return;
    running = true;
    try {
      for (const mode of reviewModes) {
        const result = await optimizeMode(db, mode, { timeZone, now: now() });
        if (result.status !== "not_enough_reviews" && result.status !== "up_to_date") console.log(`fsrs ${mode}:`, result);
      }
    } catch (err) {
      console.error("fsrs optimizer failed", err);
    } finally {
      running = false;
    }
  }
  return {
    runOnce,
    /** First pass a minute after start, then every `intervalMs`; returns a function that stops it. */
    start(intervalMs = 6 * 3_600_000) {
      const first = setTimeout(() => void runOnce(), 60_000);
      const timer = setInterval(() => void runOnce(), intervalMs);
      first.unref();
      timer.unref();
      return () => {
        clearTimeout(first);
        clearInterval(timer);
      };
    },
  };
}
