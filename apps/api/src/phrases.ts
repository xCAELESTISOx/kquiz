// Phrases are reviewed by building them: the translation is shown (or the phrase is heard), and the
// Korean is put together from its blocks mixed with a handful of wrong ones. Typing a translation
// back is not asked: a phrase can be translated many ways, so there is nothing fair to compare
// it with. Wrong blocks are what the phrase could be mistaken for: the same block with another
// particle or ending (화장실을 for 화장실이, 이에요 for 예요), and blocks of the user's other phrases.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { koreanKey, type PhrasePart } from "./cards.js";
import type { Db } from "./db/client.js";
import { cards } from "./db/schema.js";
import { shuffle } from "./reviewStore.js";

const PUNCTUATION = /[.,!?~…'"·]/g;

const clean = (text: string) => text.normalize("NFC").replace(PUNCTUATION, "").trim();

// Endings split off a phrase that is one word (감사|합니다), longest first.
const ENDINGS = ["겠습니다", "습니다", "합니다", "입니다", "이에요", "세요", "해요", "예요", "어요", "아요", "까요", "니다"];

/**
 * The blocks a phrase is built from, in order. The phrase's own breakdown when its pieces spell it,
 * else its words; a phrase of one word is cut before its ending, so there is something to build.
 */
export function phraseBlocks(korean: string, parts?: PhrasePart[] | null): string[] {
  const words = clean(korean).split(/\s+/).filter(Boolean);
  const pieces = parts?.map((p) => clean(p.ko)).filter(Boolean) ?? [];
  if (pieces.length >= words.length && pieces.join("") === words.join("")) return pieces;
  if (words.length > 1) return words;
  const word = words[0] ?? "";
  const ending = ENDINGS.find((e) => word.endsWith(e) && word.length > e.length);
  return ending ? [word.slice(0, -ending.length), ending] : [word];
}

// A block's ending swapped for one it is easily mixed up with: the same word, the wrong grammar.
const SWAPS: [string, string[]][] = [
  ["이에요", ["예요", "이세요"]],
  ["예요", ["이에요", "에요"]],
  ["습니다", ["어요", "습니까"]],
  ["합니다", ["해요", "합니까"]],
  ["세요", ["셨어요", "어요"]],
  ["어요", ["었어요", "세요"]],
  ["아요", ["았어요", "세요"]],
  ["해요", ["했어요", "하세요"]],
  ["에서", ["에", "으로"]],
  ["으로", ["에서", "로"]],
  ["을", ["를", "은"]],
  ["를", ["을", "는"]],
  ["은", ["는", "을"]],
  ["는", ["은", "를"]],
  ["이", ["가", "을"]],
  ["가", ["이", "를"]],
  ["에", ["에서", "의"]],
  ["도", ["만", "는"]],
  ["요", [""]],
];

export function grammarVariants(block: string): string[] {
  for (const [ending, others] of SWAPS) {
    if (!block.endsWith(ending) || block.length <= ending.length) continue;
    const stem = block.slice(0, -ending.length);
    return others.map((o) => stem + o).filter((v) => v.length > 0 && v !== block);
  }
  return [];
}

/** How many wrong blocks a phrase of `n` blocks gets: enough that the count gives nothing away. */
export const decoyCount = (n: number) => Math.min(6, Math.max(3, Math.ceil(n * 0.8) + 1));

export type PhraseTiles = { blocks: string[]; decoys: string[] };

/** The blocks of each phrase among `cardIds` and its wrong ones. Words among them are left out. */
export function phraseTiles(db: Db, userId: number, cardIds: number[], random = Math.random): Record<number, PhraseTiles> {
  if (!cardIds.length) return {};
  const pick = { id: cards.id, korean: cards.korean, parts: cards.parts };
  const targets = db
    .select(pick)
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.kind, "phrase"), inArray(cards.id, cardIds)))
    .all();
  if (!targets.length) return {};
  const others = db
    .select({ ...pick, kind: cards.kind })
    .from(cards)
    .where(and(eq(cards.userId, userId), isNotNull(cards.introducedAt)))
    .all();
  const phraseBlocksPool = others.filter((o) => o.kind === "phrase").map((o) => ({ id: o.id, blocks: phraseBlocks(o.korean, o.parts) }));
  const wordPool = others.filter((o) => o.kind === "word" && /^[가-힣]{1,5}$/.test(o.korean)).map((o) => ({ id: o.id, blocks: [o.korean] }));

  const out: Record<number, PhraseTiles> = {};
  for (const target of targets) {
    const blocks = phraseBlocks(target.korean, target.parts);
    const own = new Set(blocks.map(koreanKey));
    const want = decoyCount(blocks.length);
    const decoys: string[] = [];
    const add = (candidate: string) => {
      const key = koreanKey(candidate);
      if (decoys.length < want && key && !own.has(key) && !decoys.some((d) => koreanKey(d) === key)) decoys.push(candidate);
    };
    // About half are grammar look-alikes of its own blocks, the rest come from other phrases, then words.
    const variants = shuffle(blocks.flatMap(grammarVariants), random);
    variants.slice(0, Math.ceil(want / 2)).forEach(add);
    const longest = Math.max(...blocks.map((b) => b.length));
    const near = (b: string) => Math.abs(b.length - longest) + random() * 2;
    const fromPhrases = phraseBlocksPool.filter((p) => p.id !== target.id).flatMap((p) => p.blocks);
    [...fromPhrases].sort((a, b) => near(a) - near(b)).forEach(add);
    shuffle(wordPool, random).flatMap((w) => w.blocks).forEach(add);
    variants.forEach(add);
    out[target.id] = { blocks, decoys };
  }
  return out;
}

export type LinkedPart = PhrasePart & { cardId?: number };

/** A phrase's pieces with the user's card for each, matched by dictionary form, then as written. */
export function linkParts(db: Db, userId: number, parts: PhrasePart[]): LinkedPart[] {
  const keys = [...new Set(parts.flatMap((p) => [p.base, p.ko].filter((k): k is string => !!k).map(koreanKey)))];
  if (!keys.length) return parts;
  const found = new Map(
    db
      .select({ id: cards.id, key: cards.koreanKey })
      .from(cards)
      .where(and(eq(cards.userId, userId), eq(cards.kind, "word"), inArray(cards.koreanKey, keys)))
      .all()
      .map((row) => [row.key, row.id]),
  );
  return parts.map((p) => {
    const cardId = (p.base && found.get(koreanKey(p.base))) || found.get(koreanKey(p.ko));
    return cardId ? { ...p, cardId } : p;
  });
}
