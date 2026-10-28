import type { Family, QueueItem } from "./types";

/**
 * Roots that carry grammar rather than a meaning to build on: knowing 불 不 «не» from 불가능 says
 * nothing about what 불편 means. A family through one of these is no hint.
 */
const FUNCTION_ROOTS = new Set(["不", "非", "無", "未", "的", "性", "化", "第", "各", "每", "諸", "等"]);

/** Hint words per root: enough to see the pattern, few enough to read before guessing. */
const WORDS_PER_ROOT = 2;

export interface GuessHint {
  /** The shared syllable, as written in the new word. */
  syllable: string;
  words: { id: number; korean: string; meaning: string }[];
}

/** The first time a card is asked for its meaning: it has never been reviewed in that mode. */
export function isFirstShow(item: QueueItem): boolean {
  return item.mode === "meaning" && item.reps === 0;
}

/**
 * The well-learned words that share a meaningful root with a new one (학교, 대학 → 학생), for
 * guessing its meaning before seeing it. Empty when there is nothing worth guessing from.
 */
export function guessHints(families: Family[]): GuessHint[] {
  return families.flatMap((family) => {
    if (FUNCTION_ROOTS.has(family.hanja)) return [];
    const words = family.cards.filter((c) => c.known).slice(0, WORDS_PER_ROOT);
    return words.length ? [{ syllable: family.ko, words: words.map(({ id, korean, meaning }) => ({ id, korean, meaning })) }] : [];
  });
}

/** A hint word split around its shared syllable, so the syllable can be marked. */
export function splitAt(word: string, syllable: string): [string, string, string] {
  const i = word.indexOf(syllable);
  return i < 0 ? [word, "", ""] : [word.slice(0, i), syllable, word.slice(i + syllable.length)];
}
