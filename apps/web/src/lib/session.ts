// "Учить" on Today: a short session of new words and reviews together. New words come from the pool
// a few at a time (apps/api newCards.ts): met first, then a ladder of tasks, built from syllables,
// picked out by ear, written from the translation. Right after meeting a word come two quick tasks on
// it, its meaning picked out and the word built, so it is used while still fresh. A word up the ladder waits a few hours and is
// then checked once more from its translation. Reviews due in any mode fill the rest.
import { shuffled } from "./choice";
import type { Card, ChoiceOption, LearningItem, QueueItem } from "./types";

/** How many answers a session runs to (about five minutes); "Ещё" adds as many again. */
export const SESSION_TASKS = 20;
/** New words learned at once in a session (ACTIVE_WORDS in apps/api newCards.ts). */
export const NEW_AT_ONCE = 5;

/** Other cards between two steps of one word, so it isn't answered from the screen just seen. */
export const LEARN_GAP = 3;

const task = (card: Card, kind: NonNullable<QueueItem["learn"]>["kind"], check = false): QueueItem => ({
  card,
  mode: kind === "dictation" ? "listening" : kind === "intro" || kind === "pick" ? "meaning" : "speech",
  due: "",
  state: 0,
  reps: kind === "intro" ? 0 : 1,
  lapses: 0,
  learn: check ? { kind, check } : { kind },
});

/** Meeting a word before its first task. */
export const introTask = (card: Card): QueueItem => task(card, "intro");

/** Picking out what a word just met means, among its look-alikes' translations. */
export const pickTask = (card: Card): QueueItem => task(card, "pick");

/** How many translations a pick offers, the right one included. */
export const PICK_OPTIONS = 4;

/** The translations to pick from: the word's own and those of look-alikes that read differently. */
export function pickMeanings(card: Card, options: ChoiceOption[], random = Math.random): string[] {
  const norm = (m: string) => m.trim().toLowerCase();
  const seen = new Set([norm(card.meaning)]);
  const others: string[] = [];
  for (const o of options) {
    if (others.length >= PICK_OPTIONS - 1) break;
    if (seen.has(norm(o.meaning))) continue;
    seen.add(norm(o.meaning));
    others.push(o.meaning);
  }
  return others.length ? shuffled([card.meaning, ...others], random) : [];
}

/**
 * What follows meeting a word at once, before anything else: its meaning picked out (when there are
 * translations to pick from; a phrase is built instead), then the first step of its ladder.
 */
export function afterIntro(card: Card, options: ChoiceOption[], hear: boolean): QueueItem[] {
  const pick = card.kind !== "phrase" && pickMeanings(card, options).length > 0;
  return pick ? [pickTask(card), learnTask(card, 0, hear)] : [learnTask(card, 0, hear)];
}

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
