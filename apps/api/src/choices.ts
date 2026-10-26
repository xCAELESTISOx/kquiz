// Options for the "pick the Korean word" screen: the Russian is shown, the user picks the Korean
// among a few of their own words. It reviews the speech schedule (Russian → Korean recall), as the
// quiet alternative to saying the word aloud. Wrong options are words that look alike: the same
// kind of word (a verb in 다 next to a verb, a phrase next to a phrase), about as long, sharing a
// topic or a syllable. Words whose translation overlaps the card's are left out, or two options
// would both be right.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cards } from "./db/schema.js";

export const CHOICE_OPTIONS = 4;

export type ChoiceOption = { id: number; korean: string; meaning: string };

type Word = { id: number; korean: string; meaning: string; tags: string[] };

/** Every sense of a translation, lowercased: "есть, кушать (о еде)" → {"есть", "кушать"}. */
export function senses(meaning: string): Set<string> {
  return new Set(
    meaning
      .toLowerCase()
      .replace(/\([^)]*\)/g, "")
      .split(/[,;/]/)
      .map((s) => s.trim().replace(/ё/g, "е"))
      .filter(Boolean),
  );
}

function kind(korean: string): "phrase" | "predicate" | "word" {
  if (/\s/.test(korean.trim()) || /(요|니다|까)$/.test(korean)) return "phrase";
  return korean.endsWith("다") ? "predicate" : "word";
}

const syllables = (korean: string) => [...korean.replace(/[^가-힣]/g, "")];

/** Lower is more alike. */
function distance(a: Word, b: Word, random: () => number): number {
  const sa = syllables(a.korean);
  const sb = syllables(b.korean);
  let d = Math.abs(sa.length - sb.length);
  if (kind(a.korean) !== kind(b.korean)) d += 3;
  if (a.tags.some((t) => b.tags.includes(t))) d -= 1;
  if (sa.some((s) => sb.includes(s))) d -= 0.5;
  return d + random() * 1.5;
}

/** Up to CHOICE_OPTIONS - 1 wrong options for each card, from the user's other cards. */
export function distractors(db: Db, userId: number, cardIds: number[], random = Math.random): Record<number, ChoiceOption[]> {
  if (!cardIds.length) return {};
  const pick = { id: cards.id, korean: cards.korean, meaning: cards.meaning, tags: cards.tags };
  const targets = db
    .select(pick)
    .from(cards)
    .where(and(eq(cards.userId, userId), inArray(cards.id, cardIds)))
    .all();
  // Words already in reviews are ones the user has met; a deck of a handful falls back to all of them.
  let pool: Word[] = db
    .select(pick)
    .from(cards)
    .where(and(eq(cards.userId, userId), isNotNull(cards.introducedAt)))
    .all();
  if (pool.length < CHOICE_OPTIONS) pool = db.select(pick).from(cards).where(eq(cards.userId, userId)).all();

  const out: Record<number, ChoiceOption[]> = {};
  for (const target of targets) {
    const own = senses(target.meaning);
    const seen = new Set([target.korean]);
    out[target.id] = pool
      .filter((w) => w.id !== target.id && !seen.has(w.korean) && ![...senses(w.meaning)].some((s) => own.has(s)))
      .map((w) => ({ w, d: distance(target, w, random) }))
      .sort((x, y) => x.d - y.d)
      .filter(({ w }) => !seen.has(w.korean) && Boolean(seen.add(w.korean)))
      .slice(0, CHOICE_OPTIONS - 1)
      .map(({ w }) => ({ id: w.id, korean: w.korean, meaning: w.meaning }));
  }
  return out;
}
