// "Learn" on Today: a short session of new words and reviews together. New words come from the pool
// a few at a time (apps/api newCards.ts): met first, then a ladder of tasks, built from syllables,
// picked out by ear, written from the translation (typed once a session: see taskKey). Right after meeting a word come quick tasks on it
// (afterIntro), so it is used while still fresh. A word up the ladder waits a few hours and is
// then checked once more from its translation. Reviews due in any mode fill the rest.
import type { Card, ChoiceOption, LearningItem, QueueItem } from "./types";
import { placeAfter, type TaskKind } from "./variety";

/**
 * How many answers a session runs to (about five minutes); "Another round" adds as many again. The tasks
 * missed on the way are gone over once more at the end (mistakes below), however many they are.
 */
export const SESSION_TASKS = 15;

/**
 * A stretch may run on past SESSION_TASKS up to this many answers, so the words started in it finish
 * their steps instead of breaking off halfway: nothing new is begun then, no reviews either.
 */
export const SESSION_MAX = 20;

/**
 * Past the goal: where the next step of a word started in this stretch waits in the queue, or -1
 * when none does and the stretch can end. A word's step doesn't come right after that word's own
 * task (`just`, the card answered last): another word's step goes first, or a review in between when
 * only that word is left, and with no review left the stretch ends there (the word goes on next time).
 * Otherwise a word missed past the goal ran as one string of the same typing: by ear, from the
 * translation, by ear again.
 */
export function unfinished(queue: readonly QueueItem[], started: ReadonlySet<number>, just?: number): number {
  const step = (i: QueueItem) => !!i.learn && i.learn.kind !== "intro" && started.has(i.card.id);
  const other = queue.findIndex((i) => step(i) && i.card.id !== just);
  if (other >= 0 || !queue.some(step)) return other;
  return queue.findIndex((i) => !i.learn && i.card.id !== just);
}

/**
 * A session's queue after an answer (`answered` counts it, `just` is its card), with the card it
 * shows next brought to the front: past the goal that is the next step of a word begun in this
 * stretch (see unfinished), and nothing once none is left or SESSION_MAX is reached. The card shown
 * decides what is played inside the tap.
 */
export function onward(
  queue: readonly QueueItem[],
  answered: number,
  goal: number,
  started: ReadonlySet<number>,
  just?: number,
): { queue: QueueItem[]; shown?: QueueItem } {
  if (answered < goal) return { queue: [...queue], shown: queue[0] };
  if (answered >= goal + SESSION_MAX - SESSION_TASKS) return { queue: [...queue] };
  const at = unfinished(queue, started, just);
  return at < 0 ? { queue: [...queue] } : { queue: toFront(queue, at), shown: queue[at] };
}

/** `queue` with its item at `at` brought to the front. */
export function toFront<T>(queue: readonly T[], at: number): T[] {
  if (at <= 0) return [...queue];
  return [queue[at]!, ...queue.slice(0, at), ...queue.slice(at + 1)];
}

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

/** At most this many words are met for the first time in any two sessions in a row, "Another round" included (the server says what is left after the last one). */
export const NEW_PER_SESSION = 2;

/**
 * Where a session starts each new word: met first if it was never answered on its ladder, else on
 * its step (a word missed back to step 0 is built again, not met again as a new word). Only `newLeft`
 * words are met for the first time; the others wait for the next session.
 */
export function firstTasks(items: LearningItem[], hear: boolean, newLeft = NEW_PER_SESSION): QueueItem[] {
  let left = newLeft;
  return items.flatMap(({ card, step, met }) => {
    if (step !== 0 || met) return [learnTask(card, step, hear)];
    if (left <= 0) return [];
    left--;
    return [introTask(card)];
  });
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

/**
 * `item` put back `gap` cards after the one on screen (queue[0]), or at the end of a shorter queue.
 * Knowing how the tasks are shown (`kindOf`), it moves a card nearer or further rather than land next
 * to a task of its own kind.
 */
export function insertAfter(queue: QueueItem[], item: QueueItem, gap = LEARN_GAP, kindOf?: (item: QueueItem) => TaskKind | undefined): QueueItem[] {
  const at = kindOf ? placeAfter(queue, item, kindOf, gap) : Math.min(gap + 1, queue.length);
  return [...queue.slice(0, at), item, ...queue.slice(at)];
}

/**
 * One task as asked: a word's step of learning, or its review in one mode. Typing a new word is one
 * task however it is asked: by ear (dictation), from the translation (its last step) or as its later
 * check. So a word written by ear writes from the translation next session, not again in this one
 * (session 5DA3MX typed 우유 by ear and then from the translation).
 */
export const taskKey = (item: QueueItem): string => {
  const kind = item.learn?.kind;
  return `${item.card.id}:${kind === "dictation" || kind === "write" ? "type" : kind ?? item.mode}`;
};

/**
 * The queue without the tasks already answered in this session (`seen`, by taskKey): a task comes
 * once a session, and a missed one is gone over only with the mistakes at the end. A word missed on
 * its ladder so goes on next session rather than round its steps again (session N4F9NC typed 책장
 * by ear and from the translation over and over).
 */
export function unseen(queue: readonly QueueItem[], seen: ReadonlySet<string>): QueueItem[] {
  return queue.filter((i) => !seen.has(taskKey(i)));
}

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
 * A task answered right drops its earlier miss from the mistakes: a word's step missed and then
 * passed later in the same stretch (the ladder brings it back) is fixed already, not gone over again.
 */
export function withoutMistake(mistakes: readonly QueueItem[], item: QueueItem): QueueItem[] {
  const key = taskKey(item);
  return mistakes.some((m) => taskKey(m) === key) ? mistakes.filter((m) => taskKey(m) !== key) : [...mistakes];
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

/**
 * A session run short goes on with extra practice (apps/api extraPractice.ts) rather than end before
 * its goal: when the queue is down to its last card, a few words from `spare` join at its end, so new
 * words' steps the server sends back still find room among them. A word already asked in this
 * session in any way (`seen`, by taskKey) or still in the queue doesn't come. Returns the queue and
 * the spare words left.
 */
export const EXTRA_AT_ONCE = 3;
export function topUp(
  queue: readonly QueueItem[],
  spare: readonly QueueItem[],
  answered: number,
  goal: number,
  seen: ReadonlySet<string>,
): { queue: QueueItem[]; spare: QueueItem[] } {
  const left = usableSpare(queue, spare, seen);
  const room = Math.min(goal - answered - queue.length, EXTRA_AT_ONCE);
  if (queue.length > 1 || room <= 0 || !left.length) return { queue: [...queue], spare: left };
  return { queue: [...queue, ...left.slice(0, room)], spare: left.slice(room) };
}

/** The spare words that can still join: none asked in this session yet or in the queue. */
export function usableSpare(queue: readonly QueueItem[], spare: readonly QueueItem[], seen: ReadonlySet<string>): QueueItem[] {
  const asked = new Set([...seen].map((key) => key.split(":")[0]));
  for (const item of queue) asked.add(String(item.card.id));
  return spare.filter((item) => !asked.has(String(item.card.id)));
}
