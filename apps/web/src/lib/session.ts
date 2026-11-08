// "Learn" on Today: a short session of new words and reviews together. New words come from the pool
// a few at a time (apps/api newCards.ts): met first, then a ladder of tasks, built from syllables,
// picked out by ear, written from the translation. Right after meeting a word come quick tasks on it
// (afterIntro), so it is used while still fresh. A word up the ladder waits a few hours and is
// then checked once more from its translation. Reviews due in any mode fill the rest.
import type { Card, ChoiceOption, LearningItem, QueueItem } from "./types";

/**
 * How many answers a session runs to (about five minutes); "Another round" adds as many again. The tasks
 * missed on the way are gone over once more at the end (mistakes below), which makes up the rest.
 */
export const SESSION_TASKS = 15;

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

/** What a word just met can be asked right away. */
export interface FreshAbilities {
  /** Sound plays: the ear step is heard. */
  hear: boolean;
  /** This word can be said and scored aloud. */
  say: boolean;
}

/** More than one syllable (or a phrase): there is something to put together. */
export const buildable = (card: Card): boolean => card.kind === "phrase" || card.korean.replace(/[^가-힣]/g, "").length > 1;

/**
 * What follows meeting a word at once, in this order: the Korean picked by its translation among
 * look-alikes, built from its syllables (when it has more than one), said aloud. Written by ear,
 * the ladder's next step, comes a few cards later, once the server has the build.
 */
export function afterIntro(card: Card, options: ChoiceOption[], can: FreshAbilities): QueueItem[] {
  const out: QueueItem[] = [];
  if (options.length) out.push(task(card, "choose"));
  if (buildable(card)) out.push(learnTask(card, 0, can.hear));
  if (can.say && card.kind !== "phrase") out.push(task(card, "aloud"));
  return out;
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

/**
 * `item` right after the word's own tasks still ahead (picked, said aloud), or right after the card on
 * screen: the first step typed on the keyboard follows meeting a word at once.
 */
export function insertNext(queue: QueueItem[], item: QueueItem): QueueItem[] {
  let at = Math.min(1, queue.length);
  // Only the run right ahead: a missed pick put back a few cards on stays where it is.
  while (at < queue.length && queue[at]!.card.id === item.card.id && (queue[at]!.learn?.kind === "choose" || queue[at]!.learn?.kind === "aloud")) at++;
  return [...queue.slice(0, at), item, ...queue.slice(at)];
}

/** `item` put back `gap` cards after the one on screen (queue[0]), or at the end of a shorter queue. */
export function insertAfter(queue: QueueItem[], item: QueueItem, gap = LEARN_GAP): QueueItem[] {
  const at = Math.min(gap + 1, queue.length);
  return [...queue.slice(0, at), item, ...queue.slice(at)];
}

/** One task as asked: a word's step of learning, or its review in one mode. */
const taskKey = (item: QueueItem): string => `${item.card.id}:${item.learn ? item.learn.kind : item.mode}`;

/**
 * A task answered wrong joins the mistakes gone over at the end of the stretch, once: missing the
 * same pick twice is still one thing to fix.
 */
export function withMistake(mistakes: readonly QueueItem[], item: QueueItem): QueueItem[] {
  if (item.learn?.kind === "intro") return [...mistakes];
  const key = taskKey(item);
  return mistakes.some((m) => taskKey(m) === key) ? [...mistakes] : [...mistakes, item];
}

/**
 * Going over the mistakes: a fixed one is done; one missed again goes to the back, so it comes up
 * after the others (or at once when it is the last one left), until each is answered right.
 */
export function afterFix(fixes: readonly QueueItem[], ok: boolean): QueueItem[] {
  const [first, ...rest] = fixes;
  if (!first) return [];
  return ok ? rest : [...rest, first];
}
