import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";

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
