import type { RatingName } from "./types";

/** The options stay hidden this long, so the word is recalled before it can be recognised. */
export const REVEAL_MS = 3_000;

/** A right pick this long after the options showed was more search than recall. */
const SLOW_MS = 7_000;

export function shuffled<T>(items: T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The rating a pick earns: wrong is again, right is good, or hard when it took long. Counted from
 * when the options showed, so the recall pause before them (waited out or skipped) costs nothing.
 */
export function choiceRating(correct: boolean, pickMs: number): RatingName {
  if (!correct) return "again";
  return pickMs > SLOW_MS ? "hard" : "good";
}
