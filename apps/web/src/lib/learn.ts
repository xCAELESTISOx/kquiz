import { shuffled } from "./choice";
import { clozeFor, type Cloze } from "./cloze";
import type { Card, ChoiceOption } from "./types";

// "Учить" on a card: one new word taken from meeting it to producing it on its own. Each step asks
// for more recall than the one before: build it from its syllables, type it by ear, type it from the
// translation, type it into a sentence, say it. A missed step comes back after the next one. Nothing
// here is a review: no rating reaches the schedule, the review log or the stats.

export type LearnKind = "intro" | "build" | "dictation" | "write" | "cloze" | "aloud";

export interface LearnStep {
  /** Unique within the session, so a missed step is known when it comes back. */
  id: number;
  kind: LearnKind;
  cloze?: Cloze;
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
const step = (kind: LearnKind, cloze?: Cloze): LearnStep => ({ id: nextId++, kind, ...(cloze && { cloze }) });

/** The first pass over a word, in order. */
export function learnSteps(card: Card, can: LearnAbilities): LearnStep[] {
  const cloze = exampleCloze(card, 0);
  return [
    step("intro"),
    step("build"),
    ...(can.hear ? [step("dictation")] : []),
    step("write"),
    ...(cloze ? [step("cloze", cloze)] : []),
    ...(can.say ? [step("aloud")] : []),
  ];
}

/** "Закрепить": the typing steps again from memory, in a new order and through another example. */
export function reinforceSteps(card: Card, can: LearnAbilities, pass: number): LearnStep[] {
  const cloze = exampleCloze(card, pass);
  return shuffled([...(can.hear ? [step("dictation")] : []), step("write"), ...(cloze ? [step("cloze", cloze)] : [])]);
}

/** After a miss the step waits for one other, then comes again. */
export function requeue<T>(rest: T[], missed: T): T[] {
  return [...rest.slice(0, 1), missed, ...rest.slice(1)];
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
