import { z } from "zod";

// Hangul syllables and jamo, whitespace and common punctuation.
const KOREAN_ONLY = /^[\p{Script=Hangul}\s.,!?~…'"·-]+$/u;

export const MAX_SPEAKABLE_SYLLABLES = 12;

export const newCardSchema = z.object({
  korean: z.string().trim().min(1).max(200),
  meaning: z.string().trim().min(1).max(500),
  pronunciation: z.string().trim().max(200).optional(),
  romanization: z.string().trim().max(200).optional(),
  exampleKo: z.string().trim().max(500).optional(),
  exampleMeaning: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  // Defaults to isSpeakable(korean); true is accepted only for Hangul-only text.
  speakable: z.boolean().optional(),
});

export const cardPatchSchema = newCardSchema
  .extend({ tags: newCardSchema.shape.tags.unwrap() })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "nothing to update");

export type CardPatch = z.infer<typeof cardPatchSchema>;

export type NewCard = z.infer<typeof newCardSchema>;

/** Collapses whitespace so "감사  합니다 " and "감사 합니다" count as one card. */
export function normalizeKorean(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Key for duplicate detection: spacing and punctuation don't make a different word. */
export function koreanKey(text: string): string {
  return normalizeKorean(text).replace(/[\s.,!?~…'"·-]/g, "");
}

export function isKoreanOnly(text: string): boolean {
  return KOREAN_ONLY.test(text);
}

export function countSyllables(text: string): number {
  return (text.match(/[가-힣]/g) ?? []).length;
}

/** A card goes to the pronunciation queue only if the scorer can build a reference for it. */
export function isSpeakable(korean: string): boolean {
  const syllables = countSyllables(korean);
  return isKoreanOnly(korean) && syllables > 0 && syllables <= MAX_SPEAKABLE_SYLLABLES;
}

/**
 * Parses bulk input, one card per line: `한국어 — перевод`.
 * Accepts an em dash, en dash, hyphen surrounded by spaces, or a tab as the separator.
 */
export function parseBulk(input: string): { cards: NewCard[]; rejected: string[] } {
  const cards: NewCard[] = [];
  const rejected: string[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(.+?)\s*(?:\t|\s[—–-]\s)\s*(.+)$/);
    const parsed = match && newCardSchema.safeParse({ korean: match[1], meaning: match[2] });
    if (parsed?.success) cards.push(parsed.data);
    else rejected.push(line);
  }
  return { cards, rejected };
}
