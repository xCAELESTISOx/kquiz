import { and, asc, count, eq, inArray, lte, sql } from "drizzle-orm";
import { isKoreanOnly } from "./cards.js";
import { cardConditions, toCardDto, type CardDto, type CardQuery } from "./cardStore.js";
import type { Db } from "./db/client.js";
import { cardAudio, cards, reviewLog, reviewStates } from "./db/schema.js";
import { introduce, newCardsToday, startOfDay, type NewCardsToday } from "./newCards.js";
import { getFsrsSetup, schedulerFor } from "./fsrs.js";
import { applyRating, fromStateRow, toStateRow, type RatingName, type ReviewMode } from "./review.js";
import { voicesFor, type ExtraVoice } from "./voices.js";

export type QueueItem = {
  card: CardDto;
  mode: ReviewMode;
  due: string;
  state: number;
  reps: number;
  lapses: number;
  /** Listening only: other voices the word can be heard in besides the default one (voices.ts). */
  voices?: ExtraVoice[];
};

// Listening needs the card's own recording (cardAudio.ts), made from its current Korean: the phone's
// voice is a poor model for training the ear, so until the recording is there the card waits.
const hasCurrentAudio = sql`exists (select 1 from ${cardAudio} where ${cardAudio.cardId} = ${cards.id} and ${cardAudio.text} = ${cards.korean})`;

/** Review states a mode can actually show, for queries over `review_states` joined with `cards`; paused cards never. */
export const reviewable = sql`${cards.suspended} = 0 and (${reviewStates.mode} = 'meaning' or (${reviewStates.mode} = 'speech' and ${cards.speakable} = 1) or (${reviewStates.mode} = 'listening' and ${hasCurrentAudio}))`;

/** A single mode, or all of them mixed in one session, or the given ones mixed. */
export type QueueMode = ReviewMode | "mixed" | readonly ReviewMode[];

const modeCondition = (mode: QueueMode) =>
  mode === "mixed"
    ? reviewable
    : typeof mode === "string"
      ? and(eq(reviewStates.mode, mode), reviewable)
      : and(inArray(reviewStates.mode, [...mode]), reviewable);
const isMixed = (mode: QueueMode) => typeof mode !== "string" || mode === "mixed";

function toQueueItem({ card, state }: { card: typeof cards.$inferSelect; state: typeof reviewStates.$inferSelect }): QueueItem {
  return {
    card: toCardDto(card),
    mode: state.mode,
    due: state.due.toISOString(),
    state: state.state,
    reps: state.reps,
    lapses: state.lapses,
  };
}

/** Tells each listening item which other voices its word already has. */
function withVoices(db: Db, items: QueueItem[]) {
  const listening = items.filter((item) => item.mode === "listening");
  if (!listening.length) return;
  const voices = voicesFor(db, listening.map((item) => item.card.korean));
  for (const item of listening) item.voices = voices.get(item.card.korean) ?? [];
}

/**
 * Cards due in a mode: the most overdue `limit` of them, in random order, so cards added together
 * don't always come up together and one word doesn't prompt the next. Only speakable cards enter
 * the pronunciation queue, only cards with their recording the listening one; paused ones enter none.
 * Mixed takes the most overdue across all modes, each item graded in its own mode's schedule.
 */
export function dueQueue(db: Db, userId: number, mode: QueueMode, now = new Date(), limit = 50, random = Math.random): QueueItem[] {
  const items = db
    .select({ card: cards, state: reviewStates })
    .from(reviewStates)
    .innerJoin(cards, eq(cards.id, reviewStates.cardId))
    .where(and(eq(cards.userId, userId), lte(reviewStates.due, now), modeCondition(mode)))
    .orderBy(asc(reviewStates.due))
    .limit(Math.min(Math.max(limit, 1), 200))
    .all()
    .map(toQueueItem);
  withVoices(db, items);
  return isMixed(mode) ? spreadCards(items, random) : shuffle(items, random);
}

export const GROUP_LIMIT = 200;

export type GroupFilter = Pick<CardQuery, "q" | "tag" | "root" | "status" | "notReady">;

/**
 * A group the owner picked on the cards screen (a search, a tag), due or not, in random order.
 * Ratings go into the usual schedule: FSRS takes an early review into account. Queued cards in the
 * group are taken into reviews now, as "learn now" would; paused ones stay out. Mixed gives every
 * card in each mode it can be shown in.
 */
export function groupQueue(
  db: Db,
  userId: number,
  mode: QueueMode,
  filter: GroupFilter,
  now = new Date(),
  random = Math.random,
): { items: QueueItem[]; total: number } {
  return db.transaction((tx) => {
    const matched = tx
      .select({ id: cards.id, korean: cards.korean, introducedAt: cards.introducedAt })
      .from(cards)
      .where(and(...cardConditions(userId, filter), eq(cards.suspended, false)))
      .all()
      .filter((row) => !filter.notReady || !isKoreanOnly(row.korean));
    const picked = shuffle(matched, random).slice(0, GROUP_LIMIT);
    introduce(tx, picked.filter((row) => !row.introducedAt).map((row) => row.id), "early", now);
    if (!picked.length) return { items: [], total: 0 };

    const rows = tx
      .select({ card: cards, state: reviewStates })
      .from(reviewStates)
      .innerJoin(cards, eq(cards.id, reviewStates.cardId))
      .where(
        and(
          eq(cards.userId, userId),
          modeCondition(mode),
          inArray(
            cards.id,
            picked.map((row) => row.id),
          ),
        ),
      )
      .all();
    const byId = new Map<number, typeof rows>();
    for (const row of rows) byId.set(row.card.id, [...(byId.get(row.card.id) ?? []), row]);
    const items = picked.flatMap(({ id }) => (byId.get(id) ?? []).map(toQueueItem));
    withVoices(tx, items);
    return { items: isMixed(mode) ? spreadCards(items, random) : items, total: matched.length };
  });
}

/**
 * Shuffles a mixed session so the same word comes back in another mode only after `gap` other
 * cards where possible: right after its translation, hearing or saying it would be a giveaway.
 */
export function spreadCards(items: QueueItem[], random = Math.random, gap = 8): QueueItem[] {
  const pool = shuffle(items, random);
  const out: QueueItem[] = [];
  while (pool.length) {
    const recent = new Set(out.slice(-gap).map((item) => item.card.id));
    const at = pool.findIndex((item) => !recent.has(item.card.id));
    out.push(pool.splice(Math.max(at, 0), 1)[0]!);
  }
  return out;
}

/** A shuffled copy (Fisher–Yates). */
export function shuffle<T>(items: T[], random = Math.random): T[] {
  const mixed = [...items];
  for (let i = mixed.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [mixed[i], mixed[j]] = [mixed[j]!, mixed[i]!];
  }
  return mixed;
}

export type ReviewInput = {
  /** Client UUID; resending the same review is a no-op. */
  id: string;
  cardId: number;
  mode: ReviewMode;
  rating: RatingName;
  reviewedAt: Date;
  elapsedMs?: number;
};

export type ReviewOutcome =
  | { id: string; status: "applied"; due: string }
  | { id: string; status: "duplicate" }
  | { id: string; status: "card_not_found" };

/**
 * Applies ratings in the order they happened. Offline reviews arrive late and maybe twice,
 * so each is applied at its own time and only once.
 */
export function applyReviews(db: Db, userId: number, reviews: ReviewInput[], now = new Date()): ReviewOutcome[] {
  const order = reviews.map((_, i) => i).sort((a, b) => reviews[a]!.reviewedAt.getTime() - reviews[b]!.reviewedAt.getTime());
  const outcomes: ReviewOutcome[] = new Array(reviews.length);
  const seen = new Set<string>();
  db.transaction((tx) => {
    for (const i of order) {
      const review = reviews[i]!;
      outcomes[i] = applyOne(tx, userId, review, seen, now);
      seen.add(review.id);
    }
  });
  return outcomes;
}

function applyOne(
  tx: Pick<Db, "select" | "update" | "insert">,
  userId: number,
  review: ReviewInput,
  seen: Set<string>,
  now: Date,
): ReviewOutcome {
  if (seen.has(review.id) || tx.select({ id: reviewLog.id }).from(reviewLog).where(eq(reviewLog.id, review.id)).get()) {
    return { id: review.id, status: "duplicate" };
  }
  const where = and(eq(reviewStates.cardId, review.cardId), eq(reviewStates.mode, review.mode));
  const row = tx
    .select({ state: reviewStates })
    .from(reviewStates)
    .innerJoin(cards, eq(cards.id, reviewStates.cardId))
    .where(and(where, eq(cards.userId, userId)))
    .get()?.state;
  if (!row) return { id: review.id, status: "card_not_found" };
  // A clock from the future can't be trusted, and FSRS can't go back before the last review.
  let at = review.reviewedAt > now ? now : review.reviewedAt;
  if (row.lastReview && at < row.lastReview) at = row.lastReview;
  const scheduler = schedulerFor(getFsrsSetup(tx, userId, review.mode));
  const next = toStateRow(applyRating(fromStateRow(row), review.rating, at, scheduler));
  tx.update(reviewStates).set(next).where(where).run();
  tx.insert(reviewLog)
    .values({
      id: review.id,
      cardId: review.cardId,
      mode: review.mode,
      rating: review.rating,
      reviewedAt: at,
      elapsedMs: review.elapsedMs ?? null,
    })
    .run();
  return { id: review.id, status: "applied", due: next.due.toISOString() };
}

export type Stats = { cards: number; due: Record<ReviewMode, number>; reviewedToday: number; newCards: NewCardsToday };

/** `timeZone` sets where "today" starts for reviewedToday and the new-card allowance. */
export function getStats(db: Db, userId: number, now = new Date(), timeZone = "UTC"): Stats {
  const total = db.select({ n: count() }).from(cards).where(eq(cards.userId, userId)).get()?.n ?? 0;
  const dueRows = db
    .select({ mode: reviewStates.mode, n: count() })
    .from(reviewStates)
    .innerJoin(cards, eq(cards.id, reviewStates.cardId))
    .where(
      and(
        eq(cards.userId, userId),
        lte(reviewStates.due, now),
        reviewable,
      ),
    )
    .groupBy(reviewStates.mode)
    .all();
  const due = { meaning: 0, speech: 0, listening: 0 };
  for (const row of dueRows) due[row.mode] = row.n;
  const dayStart = startOfDay(now, timeZone);
  const reviewedToday =
    db
      .select({ n: count() })
      .from(reviewLog)
      .innerJoin(cards, eq(cards.id, reviewLog.cardId))
      .where(and(eq(cards.userId, userId), sql`${reviewLog.reviewedAt} >= ${dayStart.getTime()}`))
      .get()?.n ?? 0;
  return { cards: total, due, reviewedToday, newCards: newCardsToday(db, userId, now, timeZone) };
}
