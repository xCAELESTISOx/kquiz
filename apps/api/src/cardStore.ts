import { and, desc, eq, lt, sql, type SQL } from "drizzle-orm";
import { isKoreanOnly, isSpeakable, koreanKey, normalizeKorean, type CardPatch, type NewCard } from "./cards.js";
import type { Db } from "./db/client.js";
import { cards, reviewStates } from "./db/schema.js";
import { newReviewState, toStateRow, type ReviewMode } from "./review.js";

export type CardSource = "app" | "claude" | "bulk";
type CardRow = typeof cards.$inferSelect;

export type CardDto = {
  id: number;
  korean: string;
  meaning: string;
  pronunciation: string | null;
  romanization: string | null;
  exampleKo: string | null;
  exampleMeaning: string | null;
  notes: string | null;
  tags: string[];
  speakable: boolean;
  /** False when `korean` has non-Hangul text: the card can't enter the pronunciation queue. */
  readyForSpeech: boolean;
  source: CardSource;
  createdAt: string;
  updatedAt: string;
};

export function toCardDto(row: CardRow): CardDto {
  return {
    id: row.id,
    korean: row.korean,
    meaning: row.meaning,
    pronunciation: row.pronunciation,
    romanization: row.romanization,
    exampleKo: row.exampleKo,
    exampleMeaning: row.exampleMeaning,
    notes: row.notes,
    tags: row.tags,
    speakable: row.speakable,
    readyForSpeech: isKoreanOnly(row.korean),
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type Duplicate = { korean: string; existingId: number };
export type CreateResult = { created: CardDto[]; duplicates: Duplicate[] };

const emptyToNull = (value: string | undefined) => (value ? value : null);
const uniqueTags = (tags: string[]) => [...new Set(tags)];

export const reviewModes: ReviewMode[] = ["meaning", "speech"];

/**
 * Stores new cards with a fresh schedule in both modes. A card whose Korean already
 * exists (or repeats earlier in the batch) is reported as a duplicate, not stored.
 */
export function createCards(db: Db, inputs: NewCard[], source: CardSource, now = new Date()): CreateResult {
  return db.transaction((tx) => {
    const created: CardDto[] = [];
    const duplicates: Duplicate[] = [];
    for (const input of inputs) {
      const korean = normalizeKorean(input.korean);
      const key = koreanKey(korean);
      const existing = tx.select({ id: cards.id }).from(cards).where(eq(cards.koreanKey, key)).get();
      if (existing) {
        duplicates.push({ korean, existingId: existing.id });
        continue;
      }
      const row = tx
        .insert(cards)
        .values({
          korean,
          koreanKey: key,
          meaning: input.meaning,
          pronunciation: emptyToNull(input.pronunciation),
          romanization: emptyToNull(input.romanization),
          exampleKo: emptyToNull(input.exampleKo),
          exampleMeaning: emptyToNull(input.exampleMeaning),
          notes: emptyToNull(input.notes),
          tags: uniqueTags(input.tags),
          speakable: (input.speakable ?? isSpeakable(korean)) && isKoreanOnly(korean),
          source,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      const state = toStateRow(newReviewState(now));
      tx.insert(reviewStates)
        .values(reviewModes.map((mode) => ({ cardId: row.id, mode, ...state })))
        .run();
      created.push(toCardDto(row));
    }
    return { created, duplicates };
  });
}

export function getCard(db: Db, id: number): CardDto | undefined {
  const row = db.select().from(cards).where(eq(cards.id, id)).get();
  return row && toCardDto(row);
}

export type CardQuery = {
  /** Substring of the Korean text or the meaning. */
  q?: string;
  tag?: string;
  /** Only cards with non-Hangul `korean`, the "not ready for checking" filter. */
  notReady?: boolean;
  limit?: number;
  /** Id of the last card on the previous page; pages go from newest to oldest. */
  before?: number;
};

export function listCards(db: Db, query: CardQuery = {}): { cards: CardDto[]; nextBefore: number | null } {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const where: SQL[] = [];
  if (query.q) {
    const pattern = `%${query.q.toLocaleLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where.push(sql`(ulower(${cards.korean}) like ${pattern} escape '\\' or ulower(${cards.meaning}) like ${pattern} escape '\\')`);
  }
  if (query.tag) where.push(sql`exists (select 1 from json_each(${cards.tags}) where value = ${query.tag})`);
  if (query.before) where.push(lt(cards.id, query.before));

  // Hangul-only is checked in JS (SQLite has no Unicode script classes), so this filter scans.
  const rows = db
    .select()
    .from(cards)
    .where(and(...where))
    .orderBy(desc(cards.id))
    .limit(query.notReady ? 10_000 : limit + 1)
    .all()
    .filter((row) => !query.notReady || !isKoreanOnly(row.korean))
    .slice(0, limit + 1);
  const page = rows.slice(0, limit);
  return { cards: page.map(toCardDto), nextBefore: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
}

export type UpdateResult = { card: CardDto } | { error: "not_found" } | { error: "duplicate"; existingId: number };

export function updateCard(db: Db, id: number, patch: CardPatch, now = new Date()): UpdateResult {
  return db.transaction((tx) => {
    const current = tx.select().from(cards).where(eq(cards.id, id)).get();
    if (!current) return { error: "not_found" };
    const korean = patch.korean === undefined ? current.korean : normalizeKorean(patch.korean);
    const key = koreanKey(korean);
    if (key !== current.koreanKey) {
      const other = tx.select({ id: cards.id }).from(cards).where(eq(cards.koreanKey, key)).get();
      if (other) return { error: "duplicate", existingId: other.id };
    }
    const optional = (value: string | undefined, old: string | null) => (value === undefined ? old : emptyToNull(value));
    const row = tx
      .update(cards)
      .set({
        korean,
        koreanKey: key,
        meaning: patch.meaning ?? current.meaning,
        pronunciation: optional(patch.pronunciation, current.pronunciation),
        romanization: optional(patch.romanization, current.romanization),
        exampleKo: optional(patch.exampleKo, current.exampleKo),
        exampleMeaning: optional(patch.exampleMeaning, current.exampleMeaning),
        notes: optional(patch.notes, current.notes),
        tags: patch.tags ? uniqueTags(patch.tags) : current.tags,
        speakable: (patch.speakable ?? (patch.korean === undefined ? current.speakable : isSpeakable(korean))) && isKoreanOnly(korean),
        updatedAt: now,
      })
      .where(eq(cards.id, id))
      .returning()
      .get();
    return { card: toCardDto(row) };
  });
}

export function deleteCard(db: Db, id: number): boolean {
  return db.delete(cards).where(eq(cards.id, id)).run().changes > 0;
}
