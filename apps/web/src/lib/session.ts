// "Учить" on Today: a short session of new words and reviews together. New words come from the pool
// a few at a time (apps/api newCards.ts): met first, then a ladder of tasks, built from syllables,
// picked out by ear, written from the translation. A word up the ladder waits a few hours and is
// then checked once more from its translation. Reviews due in any mode fill the rest.
import type { Card, LearningItem, QueueItem } from "./types";

/** How long a session runs; the card on screen when it ends is still finished. */
export const SESSION_MS = 5 * 60_000;

/** Other cards between two steps of one word, so it isn't answered from the screen just seen. */
export const LEARN_GAP = 3;

const task = (card: Card, kind: NonNullable<QueueItem["learn"]>["kind"], check = false): QueueItem => ({
  card,
  mode: kind === "dictation" ? "listening" : kind === "intro" ? "meaning" : "speech",
  due: "",
  state: 0,
  reps: kind === "intro" ? 0 : 1,
  lapses: 0,
  learn: check ? { kind, check } : { kind },
});

/** Meeting a word before its first task. */
export const introTask = (card: Card): QueueItem => task(card, "intro");

/** The task for a ladder step (0 build, 1 by ear, 2 from the translation), or the later check. */
export function learnTask(card: Card, step: number | "check", hear: boolean): QueueItem {
  if (step === "check") return task(card, "write", true);
  if (step <= 0) return task(card, "build");
  if (step === 1 && hear) return task(card, "dictation");
  return task(card, "write");
}

/** Where a session starts each new word: met first if it hasn't climbed yet, else on its step. */
export function firstTasks(items: LearningItem[], hear: boolean): QueueItem[] {
  return items.map(({ card, step }) => (step === 0 ? introTask(card) : learnTask(card, step, hear)));
}

/** New words spread through the reviews: one, then two reviews, then the next. */
export function interleave(reviews: QueueItem[], learning: QueueItem[], every = 2): QueueItem[] {
  const out: QueueItem[] = [];
  let r = 0;
  let l = 0;
  while (r < reviews.length || l < learning.length) {
    if (l < learning.length) out.push(learning[l++]!);
    for (let k = 0; k < every && r < reviews.length; k++) out.push(reviews[r++]!);
  }
  return out;
}

/** `item` put back `gap` cards after the one on screen (queue[0]), or at the end of a shorter queue. */
export function insertAfter(queue: QueueItem[], item: QueueItem, gap = LEARN_GAP): QueueItem[] {
  const at = Math.min(gap + 1, queue.length);
  return [...queue.slice(0, at), item, ...queue.slice(at)];
}

/** "4:05": what is left of a session. */
export function timeLeft(ms: number): string {
  const s = Math.max(Math.ceil(ms / 1000), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
