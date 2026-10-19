import { and, asc, count, eq, lte, sql } from "drizzle-orm";
import { toCardDto, type CardDto } from "./cardStore.js";
import type { Db } from "./db/client.js";
import { cardAudio, cards, reviewLog, reviewStates } from "./db/schema.js";
import { newCardsToday, startOfDay, type NewCardsToday } from "./newCards.js";
import { applyRating, fromStateRow, toStateRow, type RatingName, type ReviewMode } from "./review.js";

export type QueueItem = { card: CardDto; mode: ReviewMode; due: string; state: number; reps: number; lapses: number };

// Listening needs the card's own recording (cardAudio.ts), made from its current Korean: the phone's
// voice is a poor model for training the ear, so until the recording is there the card waits.
const hasCurrentAudio = sql`exists (select 1 from ${cardAudio} where ${cardAudio.cardId} = ${cards.id} and ${cardAudio.text} = ${cards.korean})`;

/**
 * Cards due in a mode, most overdue first, with the never-reviewed ones spread among them at random
 * instead of in a block at the end. Only speakable cards enter the pronunciation queue, only cards
 * with their recording the listening one; paused ones enter none.
 */
export function dueQueue(db: Db, mode: ReviewMode, now = new Date(), limit = 50, random = Math.random): QueueItem[] {
  const items = db
    .select({ card: cards, state: reviewStates })
    .from(reviewStates)
    .innerJoin(cards, eq(cards.id, reviewStates.cardId))
    .where(
      and(
        eq(reviewStates.mode, mode),
        lte(reviewStates.due, now),
        eq(cards.suspended, false),
        mode === "speech" ? eq(cards.speakable, true) : undefined,
        mode === "listening" ? hasCurrentAudio : undefined,
      ),
    )
    .orderBy(asc(reviewStates.due))
    .limit(Math.min(Math.max(limit, 1), 200))
    .all()
    .map(({ card, state }) => ({
      card: toCardDto(card),
      mode,
      due: state.due.toISOString(),
      state: state.state,
      reps: state.reps,
      lapses: state.lapses,
    }));
  return mixNew(items, random);
}

/** Inserts each new card at a random spot among the reviews, keeping the reviews' order. */
export function mixNew<T extends { reps: number }>(items: T[], random = Math.random): T[] {
  const mixed = items.filter((item) => item.reps > 0);
  for (const item of items.filter((item) => item.reps === 0)) {
    mixed.splice(Math.floor(random() * (mixed.length + 1)), 0, item);
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
export function applyReviews(db: Db, reviews: ReviewInput[], now = new Date()): ReviewOutcome[] {
  const order = reviews.map((_, i) => i).sort((a, b) => reviews[a]!.reviewedAt.getTime() - reviews[b]!.reviewedAt.getTime());
  const outcomes: ReviewOutcome[] = new Array(reviews.length);
  const seen = new Set<string>();
  db.transaction((tx) => {
    for (const i of order) {
      const review = reviews[i]!;
      outcomes[i] = applyOne(tx, review, seen, now);
      seen.add(review.id);
    }
  });
  return outcomes;
}

function applyOne(tx: Pick<Db, "select" | "update" | "insert">, review: ReviewInput, seen: Set<string>, now: Date): ReviewOutcome {
  if (seen.has(review.id) || tx.select({ id: reviewLog.id }).from(reviewLog).where(eq(reviewLog.id, review.id)).get()) {
    return { id: review.id, status: "duplicate" };
  }
  const where = and(eq(reviewStates.cardId, review.cardId), eq(reviewStates.mode, review.mode));
  const row = tx.select().from(reviewStates).where(where).get();
  if (!row) return { id: review.id, status: "card_not_found" };
  // A clock from the future can't be trusted, and FSRS can't go back before the last review.
  let at = review.reviewedAt > now ? now : review.reviewedAt;
  if (row.lastReview && at < row.lastReview) at = row.lastReview;
  const next = toStateRow(applyRating(fromStateRow(row), review.rating, at));
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
export function getStats(db: Db, now = new Date(), timeZone = "UTC"): Stats {
  const total = db.select({ n: count() }).from(cards).get()?.n ?? 0;
  const dueRows = db
    .select({ mode: reviewStates.mode, n: count() })
    .from(reviewStates)
    .innerJoin(cards, eq(cards.id, reviewStates.cardId))
    .where(
      and(
        lte(reviewStates.due, now),
        eq(cards.suspended, false),
        sql`(${reviewStates.mode} = 'meaning' or (${reviewStates.mode} = 'speech' and ${cards.speakable} = 1) or (${reviewStates.mode} = 'listening' and ${hasCurrentAudio}))`,
      ),
    )
    .groupBy(reviewStates.mode)
    .all();
  const due = { meaning: 0, speech: 0, listening: 0 };
  for (const row of dueRows) due[row.mode] = row.n;
  const dayStart = startOfDay(now, timeZone);
  const reviewedToday =
    db.select({ n: count() }).from(reviewLog).where(sql`${reviewLog.reviewedAt} >= ${dayStart.getTime()}`).get()?.n ?? 0;
  return { cards: total, due, reviewedToday, newCards: newCardsToday(db, now, timeZone) };
}
