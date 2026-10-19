import { createEmptyCard, fsrs, Rating, type Card, type FSRS, type Grade, type State } from "ts-fsrs";

export type ReviewMode = "meaning" | "speech";

export const ratings = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const satisfies Record<string, Grade>;

export type RatingName = keyof typeof ratings;

const defaultScheduler = fsrs({ enable_fuzz: true });

export function newReviewState(now = new Date()): Card {
  return createEmptyCard(now);
}

export function applyRating(state: Card, rating: RatingName, now = new Date(), scheduler: FSRS = defaultScheduler): Card {
  return scheduler.next(state, now, ratings[rating]).card;
}

/**
 * Suggests a rating for a pronunciation attempt; the user makes the final choice.
 * Forgiving on purpose: the model flags about one syllable in six even in fluent native speech
 * (stage 0), so "weak" never lowers the rating below good, and only "wrong" syllables count.
 */
export function suggestSpeechRating(score: number, statuses: readonly ("ok" | "weak" | "wrong")[]): RatingName {
  const total = Math.max(statuses.length, 1);
  const wrong = statuses.filter((s) => s === "wrong").length;
  if (wrong === 0) return score >= 90 && !statuses.includes("weak") ? "easy" : "good";
  return wrong / total <= 0.5 ? "hard" : "again";
}

/** Columns of `review_states` that hold the FSRS card. */
export type StateRow = {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
};

export function toStateRow(card: Card): StateRow {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review ?? null,
  };
}

export function fromStateRow(row: StateRow): Card {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    ...(row.lastReview ? { last_review: row.lastReview } : {}),
  };
}
