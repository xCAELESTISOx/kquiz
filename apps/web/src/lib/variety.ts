// Keeping a session varied. Most ways of asking a word are "give the Korean for the translation"
// (typed, picked, said, and every check of a new word), so left to chance a session can run as one
// long string of the same task. Here each task gets a kind as it is shown, and the order keeps two
// tasks of a kind apart where it can.
import type { MixKind, QueueItem } from "./types";

/** How a task is shown: a way of asking a review, or a step of a new word. */
export type TaskKind = MixKind | "intro" | "build";

/** The kind of a new word's step: written (its check too), by ear, built, picked, said or met. */
export function learnKind(item: QueueItem): TaskKind | undefined {
  switch (item.learn?.kind) {
    case undefined:
      return undefined;
    case "write":
      return "write";
    case "dictation":
      return "dictation";
    case "choose":
      return "choice";
    case "aloud":
      return "aloud";
    case "build":
      return "build";
    default:
      return "intro";
  }
}

/** How far back a kind shown counts against showing it again: the less lately, the better. */
const RECENT = 8;
/** The same word in another way comes back only after this many other cards where possible. */
const CARD_GAP = 8;

/**
 * The session's order with the reviews moved so that tasks of one kind don't follow each other: each
 * place takes the review whose kind was shown least lately and differs from its
 * neighbours. Any review may come forward: they are all due, and the server sends them shuffled. New
 * words' tasks keep their places (they come in the order the ladder needs).
 */
export function vary(items: readonly QueueItem[], kindOf: (item: QueueItem) => TaskKind | undefined): QueueItem[] {
  const reviews = items.filter((i) => !i.learn);
  const out: QueueItem[] = [];
  for (let at = 0; at < items.length; at++) {
    const here = items[at]!;
    if (here.learn) {
      out.push(here);
      continue;
    }
    const after = items[at + 1]?.learn ? items[at + 1] : undefined;
    let best = 0;
    let bestScore = Infinity;
    for (let j = 0; j < reviews.length; j++) {
      const score = penalty(out, reviews[j]!, kindOf, after) + j / (reviews.length * 10);
      if (score < bestScore) [best, bestScore] = [j, score];
    }
    out.push(reviews.splice(best, 1)[0]!);
  }
  return out;
}

/** How badly `item` fits right after `before` (and before `after`): the same word close by, then the same kind. */
function penalty(before: readonly QueueItem[], item: QueueItem, kindOf: (i: QueueItem) => TaskKind | undefined, after?: QueueItem): number {
  const kind = kindOf(item);
  let score = before.slice(-CARD_GAP).some((i) => i.card.id === item.card.id) ? 100 : 0;
  if (after && after.card.id === item.card.id) score += 100;
  const last = before[before.length - 1];
  if (last && kindOf(last) === kind) score += 10;
  if (after && kindOf(after) === kind) score += 10;
  // Each time it was shown lately, the nearer the more.
  before.slice(-RECENT).forEach((i, n) => {
    if (kindOf(i) === kind) score += 1 + n / RECENT;
  });
  return score;
}

/**
 * Where to put `item` back about `gap` cards after the one on screen (queue[0]): that place, or one
 * a card nearer or further when it would land next to a task of its own kind.
 */
export function placeAfter(queue: readonly QueueItem[], item: QueueItem, kindOf: (item: QueueItem) => TaskKind | undefined, gap: number): number {
  const base = Math.min(gap + 1, queue.length);
  const kind = kindOf(item);
  const clash = (at: number) => kindOf(queue[at - 1]!) === kind || (at < queue.length && kindOf(queue[at]!) === kind);
  for (const at of [base, base + 1, base - 1, base + 2]) {
    if (at >= 2 && at <= queue.length && !clash(at)) return at;
  }
  return base;
}
