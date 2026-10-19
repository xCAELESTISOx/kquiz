import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { toCardDto, type CardDto } from "./cardStore.js";
import type { Db } from "./db/client.js";
import { cards, reviewLog } from "./db/schema.js";
import type { ReviewMode } from "./review.js";

/** Forgotten on this many different days since the last edit, a card counts as hard ("leech" in Anki). */
export const LEECH_THRESHOLD = 6;

export type Leech = {
  card: CardDto;
  /** Days the card was forgotten in each mode since it was last edited; only modes at the threshold. */
  forgotten: Partial<Record<ReviewMode, number>>;
  lastForgottenAt: string;
};

/**
 * Cards forgotten again and again. Several "again" on one day are one forgetting, so relearning steps
 * don't add up. Editing a card gives it a fresh start: only forgetting after its last change counts.
 */
export function findLeeches(db: Db, limit = 50): Leech[] {
  const day = sql<number>`cast(${reviewLog.reviewedAt} / 86400000 as integer)`;
  const forgotten = sql<number>`count(distinct ${day})`;
  const rows = db
    .select({
      cardId: reviewLog.cardId,
      mode: reviewLog.mode,
      forgotten,
      last: sql<number>`max(${reviewLog.reviewedAt})`,
    })
    .from(reviewLog)
    .innerJoin(cards, eq(cards.id, reviewLog.cardId))
    .where(
      and(
        eq(reviewLog.rating, "again"),
        // A paused card isn't reviewed, so there is nothing to fix until it comes back.
        eq(cards.suspended, false),
        gt(reviewLog.reviewedAt, cards.updatedAt),
        sql`(${reviewLog.mode} <> 'speech' or ${cards.speakable} = 1)`,
      ),
    )
    .groupBy(reviewLog.cardId, reviewLog.mode)
    .having(sql`${forgotten} >= ${LEECH_THRESHOLD}`)
    .all();
  if (rows.length === 0) return [];

  const byCard = new Map<number, { forgotten: Partial<Record<ReviewMode, number>>; last: number }>();
  for (const row of rows) {
    const entry = byCard.get(row.cardId) ?? { forgotten: {}, last: 0 };
    entry.forgotten[row.mode] = row.forgotten;
    entry.last = Math.max(entry.last, row.last);
    byCard.set(row.cardId, entry);
  }
  const worst = (e: { forgotten: Partial<Record<ReviewMode, number>> }) => Math.max(...Object.values(e.forgotten));
  const ids = [...byCard]
    .sort(([, a], [, b]) => worst(b) - worst(a) || b.last - a.last)
    .slice(0, Math.min(Math.max(limit, 1), 200))
    .map(([id]) => id);
  const found = new Map(db.select().from(cards).where(inArray(cards.id, ids)).all().map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = found.get(id);
    const entry = byCard.get(id)!;
    return row ? [{ card: toCardDto(row), forgotten: entry.forgotten, lastForgottenAt: new Date(entry.last).toISOString() }] : [];
  });
}
