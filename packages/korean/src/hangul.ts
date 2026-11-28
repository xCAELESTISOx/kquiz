// Hangul syllables as (initial, vowel, final) jamo, and back. Only modern syllables
// (U+AC00..U+D7A3) are taken apart; anything else passes through as is.

const BASE = 0xac00;
const LAST = 0xd7a3;

export const INITIALS = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"] as const;
export const VOWELS = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"] as const;
// Index 0 is "no final".
export const FINALS = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"] as const;

export interface Syllable {
  initial: string;
  vowel: string;
  final: string;
}

export function isSyllable(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return ch.length === 1 && c >= BASE && c <= LAST;
}

export function split(ch: string): Syllable | null {
  if (!isSyllable(ch)) return null;
  const i = ch.codePointAt(0)! - BASE;
  return {
    initial: INITIALS[Math.floor(i / 588)]!,
    vowel: VOWELS[Math.floor((i % 588) / 28)]!,
    final: FINALS[i % 28]!,
  };
}

export function join(s: Syllable): string {
  const i = INITIALS.indexOf(s.initial as (typeof INITIALS)[number]);
  const v = VOWELS.indexOf(s.vowel as (typeof VOWELS)[number]);
  const f = FINALS.indexOf(s.final as (typeof FINALS)[number]);
  if (i < 0 || v < 0 || f < 0) throw new Error(`not a syllable: ${s.initial}${s.vowel}${s.final}`);
  return String.fromCodePoint(BASE + i * 588 + v * 28 + f);
}

/** The last syllable of a word, taken apart. */
export function lastSyllable(word: string): Syllable | null {
  return word ? split(word.slice(-1)) : null;
}

/** Replaces the last syllable of a word. */
export function withLast(word: string, s: Syllable): string {
  return word.slice(0, -1) + join(s);
}

/** True when the word ends in a syllable with a final consonant (batchim). */
export function hasFinal(word: string): boolean {
  return Boolean(lastSyllable(word)?.final);
}

/**
 * Appends text to a word. A leading bare final jamo (ㄴ, ㄹ, ㅁ, ㅂ, ㅆ) goes under the
 * word's last syllable, which must then have no final: 가 + ㄹ → 갈, 보 + ㅆ어요 → 봤어요 is
 * handled by the caller contracting first.
 */
export function attach(word: string, text: string): string {
  const head = text[0];
  if (head && (FINALS as readonly string[]).includes(head) && !isSyllable(head)) {
    const last = lastSyllable(word);
    if (!last || last.final) throw new Error(`cannot put ${head} under ${word}`);
    return withLast(word, { ...last, final: head }) + text.slice(1);
  }
  return word + text;
}
