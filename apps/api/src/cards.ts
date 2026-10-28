import { z } from "zod";

// Hangul syllables and jamo, whitespace and common punctuation.
const KOREAN_ONLY = /^[\p{Script=Hangul}\s.,!?~…'"·-]+$/u;

export const MAX_SPEAKABLE_SYLLABLES = 12;

/** Claude must give exactly this many examples when it adds or edits a card. */
export const EXAMPLES_PER_CARD = 3;

/** A Korean sentence that uses the word, with its Russian translation. */
export const exampleSchema = z.object({
  ko: z.string().trim().min(1).max(300).regex(/\p{Script=Hangul}/u, "must be a Korean sentence"),
  ru: z.string().trim().min(1).max(300),
});

export type Example = z.infer<typeof exampleSchema>;

/**
 * A Sino-Korean root of the word: one syllable, its hanja and a short Russian gloss, e.g.
 * 학 學 «учёба». Cards that share a hanja are one word family; the hanja is the key, because
 * one syllable has many unrelated roots (수 水 «вода», 수 數 «число»).
 */
export const rootSchema = z.object({
  ko: z.string().trim().regex(/^[가-힣]$/, "must be one Hangul syllable"),
  hanja: z.string().trim().regex(/^\p{Script=Han}$/u, "must be one hanja character"),
  meaning: z.string().trim().min(1).max(60),
});

export type Root = z.infer<typeof rootSchema>;

export const MAX_ROOTS = 8;

export const CARD_KINDS = ["word", "phrase"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** 합쇼체 (formal), 해요체 (polite), 반말 (casual). */
export const REGISTERS = ["formal", "polite", "casual"] as const;
export type Register = (typeof REGISTERS)[number];

/**
 * One piece of a phrase as it stands in it (가세요), its dictionary form when that differs (가다), and
 * what it means. In order, the pieces spell the whole phrase; the dictionary form links the piece
 * to the user's card for that word.
 */
export const phrasePartSchema = z.object({
  ko: z.string().trim().min(1).max(60).regex(/\p{Script=Hangul}/u, "must be Korean"),
  base: z.string().trim().max(60).optional(),
  meaning: z.string().trim().min(1).max(120),
});

export type PhrasePart = z.infer<typeof phrasePartSchema>;

export const MAX_PARTS = 12;

export const newCardSchema = z.object({
  korean: z.string().trim().min(1).max(200),
  meaning: z.string().trim().min(1).max(500),
  pronunciation: z.string().trim().max(200).optional(),
  romanization: z.string().trim().max(200).optional(),
  examples: z.array(exampleSchema).max(EXAMPLES_PER_CARD).optional(),
  notes: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  // Empty for a native Korean word; left out while nobody has looked.
  roots: z.array(rootSchema).max(MAX_ROOTS).optional(),
  // Defaults to isSpeakable(korean); true is accepted only for Hangul-only text.
  speakable: z.boolean().optional(),
  // A word when left out.
  kind: z.enum(CARD_KINDS).optional(),
  parts: z.array(phrasePartSchema).max(MAX_PARTS).optional(),
  register: z.enum(REGISTERS).optional(),
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
