import type { RatingName } from "./types";

/** A right pick this slow was more search than recall. */
const SLOW_MS = 10_000;

export function shuffled<T>(items: T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The rating a pick earns: wrong is again, right is good, or hard when it took long. */
export function choiceRating(correct: boolean, elapsedMs: number): RatingName {
  if (!correct) return "again";
  return elapsedMs > SLOW_MS ? "hard" : "good";
}
