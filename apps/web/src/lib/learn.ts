import { shuffled } from "./choice";
import { clozeFor, type Cloze } from "./cloze";
import type { Card, ChoiceOption } from "./types";

// "Learn" on a card: one new word taken from meeting it to producing it on its own. Each step asks
// for more recall than the one before: build it from its syllables, type it by ear, type it from the
// translation, type it into a sentence, say it. A missed step comes back after the next one. Nothing
// here is a review: no rating reaches the schedule, the review log or the stats.

// A phrase is learned the way it is reviewed: met whole and built from its blocks by translation
// ("phrase"; the first time with the phrase shown first), then by ear ("phrase-ear").
export type LearnKind = "intro" | "build" | "dictation" | "write" | "cloze" | "aloud" | "phrase" | "phrase-ear";

export interface LearnStep {
  /** Unique within the session, so a missed step is known when it comes back. */
  id: number;
  kind: LearnKind;
  cardId: number;
  cloze?: Cloze;
  /** A phrase's first build, shown whole before it is asked. */
  first?: boolean;
}

export interface LearnAbilities {
  /** The card's recording can play. */
  hear: boolean;
  /** A microphone is there and the card is speakable. */
  say: boolean;
}

/** The word in one of its examples, the `nth` that has it (cycling). */
export function exampleCloze(card: Card, nth: number): Cloze | undefined {
  return clozeFor({ card, state: 2, reps: nth * 2 });
}

let nextId = 1;
const step = (card: Card, kind: LearnKind, extra?: { cloze?: Cloze; first?: boolean }): LearnStep => ({
  id: nextId++,
  kind,
  cardId: card.id,
  ...(extra?.cloze && { cloze: extra.cloze }),
  ...(extra?.first && { first: true }),
});

/** The first pass over a word, in order. */
export function learnSteps(card: Card, can: LearnAbilities): LearnStep[] {
  if (card.kind === "phrase") return [step(card, "phrase", { first: true }), ...(can.hear ? [step(card, "phrase-ear")] : []), step(card, "phrase")];
  const cloze = exampleCloze(card, 0);
  return [
    step(card, "intro"),
    step(card, "build"),
    ...(can.hear ? [step(card, "dictation")] : []),
    step(card, "write"),
    ...(cloze ? [step(card, "cloze", { cloze })] : []),
    ...(can.say ? [step(card, "aloud")] : []),
  ];
}

/** "Practice again": the typing steps again from memory, in a new order and through another example. */
export function reinforceSteps(card: Card, can: LearnAbilities, pass: number): LearnStep[] {
  if (card.kind === "phrase") return shuffled([...(can.hear ? [step(card, "phrase-ear")] : []), step(card, "phrase")]);
  const cloze = exampleCloze(card, pass);
  return shuffled([...(can.hear ? [step(card, "dictation")] : []), step(card, "write"), ...(cloze ? [step(card, "cloze", { cloze })] : [])]);
}

/** After a miss the step waits for `after` others (one for a single word, a few in a group), then comes again. */
export function requeue<T>(rest: T[], missed: T, after = 1): T[] {
  return [...rest.slice(0, after), missed, ...rest.slice(after)];
}

/** How many words "Learn" takes at once; the rest of a group comes as the next portion. */
export const GROUP_SIZE = 10;

// How hard each step is: a group goes through all its words at one level before the next.
const LEVEL: Record<LearnKind, number> = { intro: 0, build: 0, phrase: 2, dictation: 1, "phrase-ear": 1, write: 2, cloze: 3, aloud: 4 };

/**
 * Several words at once. They are met in turn, each built from its syllables one word later (intro A,
 * intro B, build A, intro C, build B…), so the build is from memory, not from the screen just seen.
 * Then every word is asked by ear, then from its translation, then in a sentence, then aloud, each
 * round in a new order, and never the same word twice in a row when it can be helped.
 */
export function groupSteps(cards: Card[], can: (card: Card) => LearnAbilities, random = Math.random): LearnStep[] {
  if (cards.length === 1) return learnSteps(cards[0]!, can(cards[0]!));
  const meet: LearnStep[] = [];
  const later: LearnStep[][] = [];
  let pending: LearnStep | undefined;
  for (const card of cards) {
    const [first, ...rest] = learnSteps(card, can(card));
    meet.push(first!);
    if (pending) meet.push(pending);
    pending = undefined;
    for (const s of rest) {
      if (s.kind === "build") pending = s;
      else (later[LEVEL[s.kind]] ??= []).push(s);
    }
  }
  if (pending) meet.push(pending);
  const rounds = [meet, ...later.filter(Boolean).map((round) => shuffled(round, random))];
  // A word comes once a round, so only where two rounds meet can it follow itself: then another word
  // of the round starts it, or, when the round has just that one, the round before ends otherwise.
  for (let i = 1; i < rounds.length; i++) {
    const prev = rounds[i - 1]!;
    const cur = rounds[i]!;
    if (cur[0]!.cardId !== prev.at(-1)!.cardId) continue;
    const k = cur.findIndex((s) => s.cardId !== prev.at(-1)!.cardId);
    if (k > 0) [cur[0], cur[k]] = [cur[k]!, cur[0]!];
    else if (i > 1) {
      const before = rounds[i - 2]!.at(-1)!.cardId;
      const m = prev.findIndex((s, n) => n < prev.length - 1 && s.cardId !== cur[0]!.cardId && (n > 0 || prev.at(-1)!.cardId !== before));
      if (m >= 0) [prev[m], prev[prev.length - 1]] = [prev.at(-1)!, prev[m]!];
    }
  }
  return rounds.flat();
}

/** "Practice again" for a group: each word's typing steps again, all in one shuffled round. */
export function groupReinforce(cards: Card[], can: (card: Card) => LearnAbilities, pass: number, random = Math.random): LearnStep[] {
  if (cards.length === 1) return reinforceSteps(cards[0]!, can(cards[0]!), pass);
  return apart(shuffled(cards.flatMap((card) => reinforceSteps(card, can(card), pass)), random));
}

/** Moves a step that would follow one of the same word further on, where it doesn't. */
export function apart(steps: LearnStep[]): LearnStep[] {
  const out = [...steps];
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.cardId !== out[i - 1]!.cardId) continue;
    // The nearest one that fits, so a step stays in its own round wherever it can.
    const j = out.findIndex(
      (s, k) =>
        k > i &&
        s.cardId !== out[i - 1]!.cardId &&
        (k === i + 1 || out[k - 1]!.cardId !== out[i]!.cardId) &&
        out[k + 1]?.cardId !== out[i]!.cardId,
    );
    if (j > 0) [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// Common syllables for decoys when the user has few look-alike words yet.
const FILLER = [..."이가는다요하고서지기도나리사어아주로"];

/**
 * The word's syllables with a few decoys, shuffled: taken from the look-alike words first, so the
 * decoys are ones that could be mixed up with it.
 */
export function buildTiles(card: Card, options: ChoiceOption[], random = Math.random): string[] {
  const own = [...card.korean.replace(/\s/g, "")];
  const decoys: string[] = [];
  const pool = [...options.flatMap((o) => [...o.korean.replace(/\s/g, "")]), ...shuffled(FILLER, random)];
  for (const s of pool) {
    if (decoys.length >= Math.min(3, Math.max(2, Math.ceil(own.length / 2)))) break;
    if (!own.includes(s) && !decoys.includes(s)) decoys.push(s);
  }
  return shuffled([...own, ...decoys], random);
}
