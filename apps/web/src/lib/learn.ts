import type { Card, QueueItem, ReviewMode } from "./types";

// "Учить" on a card: one word gone through in every mode, round after round, for as long as wanted.
// Nothing of it is a review: no rating reaches the schedule, the review log or the stats, so the word
// stays due when it was and keeps coming up as before.

export interface LearnStep {
  item: QueueItem;
  /** Picked among look-alikes instead of said aloud. */
  pick?: boolean;
}

export interface LearnAbilities {
  /** The card's recording can play. */
  hear: boolean;
  /** A microphone is there and the card is speakable. */
  say: boolean;
  /** The card has look-alikes to pick from. */
  pick: boolean;
}

/**
 * From recognising the word to producing it: read it, hear it, pick it by its translation, say it.
 * Every other round asks through the card's examples (`reps` even, as clozeFor reads it), each time
 * another one, so the word is met in sentences and not only on its own.
 */
export function learnRound(card: Card, round: number, can: LearnAbilities): LearnStep[] {
  const item = (mode: ReviewMode): QueueItem => ({
    card,
    mode,
    due: new Date().toISOString(),
    // As a learned card, so clozeFor turns to the examples on even rounds.
    state: 2,
    reps: round,
    lapses: 0,
  });
  const steps: LearnStep[] = [{ item: item("meaning") }];
  if (can.hear) steps.push({ item: item("listening") });
  if (can.pick) steps.push({ item: item("speech"), pick: true });
  if (can.say) steps.push({ item: item("speech") });
  return steps;
}
