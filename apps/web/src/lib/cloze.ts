import type { QueueItem } from "./types";

// A word learned only as a bare card starts being recognised by the card itself. So now and then
// the question comes as one of the card's examples instead: the word marked in meaning reviews,
// left out in pronunciation. The schedule stays the same; only the prompt changes.

export interface Cloze {
  /** Index into card.examples. */
  example: number;
  before: string;
  word: string;
  after: string;
}

const FSRS_REVIEW = 2;
// Hangul and Latin letters belong to a word; anything else (spaces, punctuation, quotes) ends it.
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Where the card's word sits in a sentence. Korean inflects, so a verb or adjective (…다) is
 * looked for by its stem, and the match runs to the end of that word: 먹다 → 먹어요, 공부하다 → 공부해요.
 * A noun is marked without its particle: 바다 → [바다]에. Matches only at the start of a word,
 * so 가다 does not hit the 가 in 제가. Irregular stems (듣다 → 들어요) are not found, and that's fine.
 */
export function findWord(word: string, sentence: string): { start: number; end: number } | undefined {
  const at = (needle: string, inflected: boolean) => {
    for (let i = sentence.indexOf(needle); i !== -1; i = sentence.indexOf(needle, i + 1)) {
      if (i > 0 && WORD_CHAR.test(sentence[i - 1]!)) continue;
      let end = i + needle.length;
      if (inflected) while (end < sentence.length && WORD_CHAR.test(sentence[end]!)) end++;
      return { start: i, end };
    }
    return undefined;
  };
  const exact = at(word, false);
  if (exact || !word.endsWith("다") || word.length < 2) return exact;
  const stem = word.slice(0, -1);
  // 하다 verbs and some irregulars change the stem's last syllable (하 → 해, 쁘 → 뻐); a shorter
  // stem still needs two syllables, or 예쁘다 would find every 예.
  return at(stem, true) ?? (stem.length >= 3 ? at(stem.slice(0, -1), true) : undefined);
}

/**
 * Every other review of a learned card is asked through an example, cycling through them.
 * New and relearning cards keep the bare word until they settle.
 */
export function clozeFor({ card, state, reps }: Pick<QueueItem, "card" | "state" | "reps">): Cloze | undefined {
  if (state !== FSRS_REVIEW || reps % 2 === 1 || card.examples.length === 0) return undefined;
  const first = Math.floor(reps / 2) % card.examples.length;
  for (let k = 0; k < card.examples.length; k++) {
    const example = (first + k) % card.examples.length;
    const sentence = card.examples[example]!.ko;
    const found = findWord(card.korean, sentence);
    if (found)
      return {
        example,
        before: sentence.slice(0, found.start),
        word: sentence.slice(found.start, found.end),
        after: sentence.slice(found.end),
      };
  }
  return undefined;
}
