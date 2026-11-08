// Similar words: two of the user's cards easy to mix up, such as 휴지통 "wastebasket" and
// 쓰레기통 "trash can", or 아래 and 밑. A link goes both ways and carries a short note on how the
// two differ. When the translation is shown and the Korean asked for, answering with the linked word
// isn't counted as a mistake: the app says which word that was and asks for the other one.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client.js";
import { cards, similarWords } from "./db/schema.js";

export const MAX_SIMILAR = 8;

export const similarNoteSchema = z.string().trim().max(300);

/** A word linked to a card as easy to confuse with it. */
export type SimilarWord = { id: number; korean: string; meaning: string; note: string | null };

/** Pairs are stored once, the smaller id first. */
const ordered = (a: number, b: number) => (a < b ? [a, b] : [b, a]) as [number, number];

/** Each card's similar words, by card id; cards with none are left out. */
export function similarFor(db: Db, userId: number, ids: number[]): Map<number, SimilarWord[]> {
  const out = new Map<number, SimilarWord[]>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const links = db
    .select({ cardId: similarWords.cardId, otherId: similarWords.otherId, note: similarWords.note })
    .from(similarWords)
    .where(and(eq(similarWords.userId, userId), or(inArray(similarWords.cardId, unique), inArray(similarWords.otherId, unique))))
    .all();
  if (!links.length) return out;
  const wanted = new Set(unique);
  const otherIds = [...new Set(links.flatMap((l) => [l.cardId, l.otherId]))];
  const words = new Map(
    db
      .select({ id: cards.id, korean: cards.korean, meaning: cards.meaning })
      .from(cards)
      .where(and(eq(cards.userId, userId), inArray(cards.id, otherIds)))
      .all()
      .map((w) => [w.id, w]),
  );
  const add = (id: number, otherId: number, note: string | null) => {
    const other = words.get(otherId);
    if (!wanted.has(id) || !other) return;
    const list = out.get(id) ?? [];
    list.push({ ...other, note });
    out.set(id, list);
  };
  for (const link of links) {
    add(link.cardId, link.otherId, link.note);
    add(link.otherId, link.cardId, link.note);
  }
  for (const list of out.values()) list.sort((a, b) => a.id - b.id);
  return out;
}

/** Fills in `similar` on cards that came from the database. Returns the same array. */
export function withSimilar<T extends { id: number; similar: SimilarWord[] }>(db: Db, userId: number, list: T[]): T[] {
  const found = similarFor(db, userId, list.map((c) => c.id));
  for (const card of list) card.similar = found.get(card.id) ?? [];
  return list;
}

export type LinkResult = "linked" | "not_found" | "same_card" | "too_many";

/**
 * Links two of the user's cards, or updates the note of a link they already have. A note left out
 * keeps the old one; "" clears it.
 */
export function linkSimilar(db: Db, userId: number, a: number, b: number, note: string | undefined, now = new Date()): LinkResult {
  if (a === b) return "same_card";
  return db.transaction((tx) => {
    const found = tx
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.userId, userId), inArray(cards.id, [a, b])))
      .all();
    if (found.length !== 2) return "not_found";
    const [cardId, otherId] = ordered(a, b);
    const existing = tx
      .select({ note: similarWords.note })
      .from(similarWords)
      .where(and(eq(similarWords.cardId, cardId), eq(similarWords.otherId, otherId)))
      .get();
    if (existing) {
      if (note !== undefined)
        tx.update(similarWords)
          .set({ note: note.trim() || null })
          .where(and(eq(similarWords.cardId, cardId), eq(similarWords.otherId, otherId)))
          .run();
      return "linked";
    }
    const full = [a, b].some(
      (id) =>
        (tx
          .select({ n: sql<number>`count(*)` })
          .from(similarWords)
          .where(or(eq(similarWords.cardId, id), eq(similarWords.otherId, id)))
          .get()?.n ?? 0) >= MAX_SIMILAR,
    );
    if (full) return "too_many";
    tx.insert(similarWords)
      .values({ userId, cardId, otherId, note: note?.trim() || null, createdAt: now })
      .run();
    return "linked";
  });
}

/** True when there was such a link. */
export function unlinkSimilar(db: Db, userId: number, a: number, b: number): boolean {
  const [cardId, otherId] = ordered(a, b);
  return (
    db
      .delete(similarWords)
      .where(and(eq(similarWords.userId, userId), eq(similarWords.cardId, cardId), eq(similarWords.otherId, otherId)))
      .run().changes > 0
  );
}
