import { shuffled } from "./choice";
import type { Card, PhraseTiles, RatingName } from "./types";

// A phrase is reviewed by building it from blocks: from its translation (the meaning schedule) or by
// ear (listening). The server cuts the blocks and picks the wrong ones (apps/api/src/phrases.ts);
// what's here checks the answer, grades it, and stands in when the server's blocks are not there.

const PUNCTUATION = /[.,!?~…'"·]/g;

/** The phrase's words, when the server's blocks are missing: nothing wrong to choose from then. */
export function fallbackTiles(card: Card): PhraseTiles {
  const words = card.korean.replace(PUNCTUATION, "").trim().split(/\s+/).filter(Boolean);
  return { blocks: words, decoys: [] };
}

export interface Tile {
  /** Position in the shuffled bank, so two equal blocks stay two tiles. */
  id: number;
  text: string;
}

export function bank(tiles: PhraseTiles, random = Math.random): Tile[] {
  return shuffled([...tiles.blocks, ...tiles.decoys], random).map((text, id) => ({ id, text }));
}

export type SlotState = "right" | "wrong";

/** Each slot right or wrong; a block counts as right in its place, whichever equal tile was used. */
export function checkBuild(blocks: string[], picked: string[]): SlotState[] {
  return blocks.map((block, i) => (picked[i] === block ? "right" : "wrong"));
}

/** Right first time is good, right but slow is hard: a slow build is a phrase not yet at hand. */
export function buildRating(correct: boolean, elapsedMs: number, blocks: number): RatingName {
  if (!correct) return "again";
  return elapsedMs > 6_000 + blocks * 2_500 ? "hard" : "good";
}

/** The phrase's punctuation, which the blocks leave out, to put back after the last one. */
export function trailingPunctuation(korean: string): string {
  return korean.trim().match(/[.!?~…]+$/)?.[0] ?? "";
}

export const REGISTER_LABELS = {
  formal: "formal",
  polite: "polite",
  casual: "casual",
} as const;

/** A guess for the add form: several words, or a polite or formal ending (감사합니다, 괜찮아요). */
export function looksLikePhrase(korean: string): boolean {
  const text = korean.trim().replace(/[.!?~…]+$/, "");
  return /\s/.test(text) || /(요|니다|니까)$/.test(text);
}
