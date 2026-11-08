import type { Card, RatingName, SimilarWord } from "./types";

// Similar words (휴지통 / 쓰레기통): when the translation is shown and the Korean asked for, answering with
// the linked word is a known confusion, not a blank. The app says which word that was and asks for
// the other one; the answer then still counts, a little lower (hard), since it needed the nudge.

const key = (text: string) => text.normalize("NFC").replace(/[\s.,!?~…'"·-]/g, "");

/** The card's similar word that was answered instead of it, if that is what happened. */
export function similarAnswer(card: Card, answer: string): SimilarWord | undefined {
  const typed = key(answer);
  if (!typed || typed === key(card.korean)) return undefined;
  return card.similar?.find((w) => key(w.korean) === typed);
}

/** Right after a nudge is still right, but not a clean recall: good becomes hard. */
export function afterNudge(rating: RatingName, nudged: boolean): RatingName {
  return nudged && (rating === "good" || rating === "easy") ? "hard" : rating;
}
