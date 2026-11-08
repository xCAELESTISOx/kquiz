// Options for the "pick the Korean word" screen: the Russian is shown, the user picks the Korean
// among a few of their own words. It reviews the speech schedule (Russian → Korean recall), as the
// quiet alternative to saying the word aloud. Wrong options are words that look alike: the same
// kind of word (a verb in 다 next to a verb, a phrase next to a phrase), about as long, sharing a
// topic or a syllable, spelled and so sounding alike letter by letter (사과 next to 사각, 바지 next to 비자). Words whose translation overlaps the card's are left out, or two options
// would both be right. A word linked as similar (similar.ts) does come in, as one of the options:
// picking it is the confusion the link is about, and the app answers it with a hint, not a mistake.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cards } from "./db/schema.js";
import { similarFor } from "./similar.js";

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

const INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const MEDIALS = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const FINALS = ["", ..."ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"];

/** The letters of a word, syllable by syllable: 사과 → ㅅㅏㄱㅘ. */
export function jamo(korean: string): string[] {
  return syllables(korean).flatMap((s) => {
    const n = s.charCodeAt(0) - 0xac00;
    return [INITIALS[Math.floor(n / 588)]!, MEDIALS[Math.floor((n % 588) / 28)]!, FINALS[n % 28]!].filter(Boolean);
  });
}

/** How far apart two words are in letters, 0 (the same) to 1 (nothing in common). */
export function letterDistance(a: string, b: string): number {
  const x = jamo(a);
  const y = jamo(b);
  if (!x.length || !y.length) return 1;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length]! / Math.max(x.length, y.length);
}

/** Lower is more alike. */
function distance(a: Word, b: Word, random: () => number): number {
  const sa = syllables(a.korean);
  const sb = syllables(b.korean);
  let d = Math.abs(sa.length - sb.length);
  if (kind(a.korean) !== kind(b.korean)) d += 3;
  if (a.tags.some((t) => b.tags.includes(t))) d -= 1;
  if (sa.some((s) => sb.includes(s))) d -= 0.5;
  // Spelled alike reads and sounds alike: the one to tell apart, not just another word.
  d += 2 * letterDistance(a.korean, b.korean);
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

  const similar = similarFor(db, userId, targets.map((t) => t.id));
  const out: Record<number, ChoiceOption[]> = {};
  for (const target of targets) {
    const own = senses(target.meaning);
    const seen = new Set([target.korean]);
    const lookalike = similar.get(target.id)?.[Math.floor(random() * similar.get(target.id)!.length)];
    const first: ChoiceOption[] = lookalike ? [{ id: lookalike.id, korean: lookalike.korean, meaning: lookalike.meaning }] : [];
    if (lookalike) seen.add(lookalike.korean);
    out[target.id] = first.concat(pool
      .filter((w) => w.id !== target.id && !seen.has(w.korean) && ![...senses(w.meaning)].some((s) => own.has(s)))
      .map((w) => ({ w, d: distance(target, w, random) }))
      .sort((x, y) => x.d - y.d)
      .filter(({ w }) => !seen.has(w.korean) && Boolean(seen.add(w.korean)))
      .slice(0, CHOICE_OPTIONS - 1 - first.length)
      .map(({ w }) => ({ id: w.id, korean: w.korean, meaning: w.meaning })));
  }
  return out;
}
