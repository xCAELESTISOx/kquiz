import type { NewCard } from "./types";

// Mirrors apps/api/src/cards.ts so the Add screen can preview instantly; the server stays the authority.
const KOREAN_ONLY = /^[\p{Script=Hangul}\s.,!?~…'"·-]+$/u;
const HAS_HANGUL = /\p{Script=Hangul}/u;

export function isKoreanOnly(text: string): boolean {
  return KOREAN_ONLY.test(text);
}

export function hasHangul(text: string): boolean {
  return HAS_HANGUL.test(text);
}

export function normalizeKorean(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ");
}

export interface BulkLine {
  line: number;
  raw: string;
  card?: NewCard;
  error?: string;
}

/**
 * Parses bulk input, one card per line: `한국어 — перевод`.
 * Accepts an em dash, en dash, hyphen surrounded by spaces, or a tab as the separator.
 * Lines where the sides are swapped (`вода — 물`) are flipped, since that is an easy slip when pasting.
 */
export function parseBulk(input: string): BulkLine[] {
  const result: BulkLine[] = [];
  input.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const match = line.match(/^(.+?)\s*(?:\t|\s[—–-]\s)\s*(.+)$/);
    if (!match) {
      result.push({ line: index + 1, raw: line, error: "Нет разделителя «—»" });
      return;
    }
    let korean = normalizeKorean(match[1]!);
    let meaning = match[2]!.trim();
    if (!hasHangul(korean) && hasHangul(meaning)) [korean, meaning] = [normalizeKorean(meaning), korean];
    if (!hasHangul(korean)) {
      result.push({ line: index + 1, raw: line, error: "Нет корейского слова" });
      return;
    }
    if (korean.length > 200 || meaning.length > 500) {
      result.push({ line: index + 1, raw: line, error: "Слишком длинная строка" });
      return;
    }
    result.push({ line: index + 1, raw: line, card: { korean, meaning } });
  });
  return result;
}

/** A card's pronunciation to show in brackets, or nothing when it is just the spelling. Stored bare; brackets typed in are dropped. */
export function shownPronunciation(card: { korean: string; pronunciation?: string | null }): string | undefined {
  const bare = card.pronunciation?.replace(/^[\s[]+|[\s\]]+$/g, "");
  return bare && bare !== card.korean ? bare : undefined;
}
