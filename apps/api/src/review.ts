import { createEmptyCard, fsrs, Rating, type Card, type Grade, type State } from "ts-fsrs";

export type ReviewMode = "meaning" | "speech";

export const ratings = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const satisfies Record<string, Grade>;

export type RatingName = keyof typeof ratings;

const scheduler = fsrs({ enable_fuzz: true });

export function newReviewState(now = new Date()): Card {
  return createEmptyCard(now);
}

export function applyRating(state: Card, rating: RatingName, now = new Date()): Card {
  return scheduler.next(state, now, ratings[rating]).card;
}

/** Suggests a rating from a pronunciation score; the user makes the final choice. */
export function suggestRating(score: number): RatingName {
  if (score < 50) return "again";
  if (score < 75) return "hard";
  if (score < 92) return "good";
  return "easy";
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
