import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cards, reviewStates } from "./db/schema.js";
import { startOfDay } from "./newCards.js";
import type { ReviewMode } from "./review.js";
import { reviewable, shuffle, toQueueItem, withVoices, type QueueItem } from "./reviewStore.js";
import { withSimilar } from "./similar.js";
import { wordSkills, type Skill, type WordSkills } from "./taskStats.js";

/**
 * Extra practice: a "Learn" session that runs out of reviews and new words before its goal goes on
 * with words already learned, rather than end early (session C8K8AR stopped at 11 of 15 with nothing
 * due). It is practice on top of the schedule, so FSRS is left as it is: a right answer changes
 * nothing, and a miss only brings that mode's review forward to now, so the word comes up as a
 * usual review next session and that review gives the rating (applyReviews, `extra`). Its answers
 * go into the task statistics like any other task's (taskStats.ts).
 *
 * Which words: about half the ones missed most (fresh misses weigh more), a third the ones learned
 * over the last EXTRA_RECENT_DAYS, the rest any learned word, the longest unseen first. A word due in
 * any mode is in the session's queue already, and one reviewed or learned today was just practised,
 * so neither comes. Each word comes once, in one mode, the one it goes worse in.
 */
export const EXTRA_LIMIT = 30;
export const EXTRA_RECENT_DAYS = 14;

const DAY = 86_400_000;

/** The ways each mode is asked (taskStats.ts skills): only "give the Korean" and by ear. */
const SKILLS_OF: Partial<Record<ReviewMode, Skill[]>> = {
  speech: ["speak", "choose", "write"],
  listening: ["listen", "dictation"],
  // Phrases aren't said aloud yet; their meaning is built from blocks, which is giving the Korean too.
  meaning: ["build"],
};

/** How badly a word goes in a mode: its first-try misses there, smoothed as in lib/mix.ts weakWays. */
function weakness(skills: WordSkills | undefined, mode: ReviewMode): number {
  let answers = 0;
  let missed = 0;
  for (const skill of SKILLS_OF[mode] ?? []) {
    answers += skills?.[skill]?.answers ?? 0;
    missed += skills?.[skill]?.missed ?? 0;
  }
  return (missed + 0.5) / (answers + 3);
}

function pickWeighted<T>(items: T[], weight: (item: T) => number, random: () => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let left = random() * total;
  for (const item of items) {
    left -= weight(item);
    if (left <= 0) return item;
  }
  return items[items.length - 1]!;
}

export function extraPractice(
  db: Db,
  userId: number,
  { limit = 15, exclude = [] }: { limit?: number; exclude?: number[] },
  now: Date,
  timeZone: string,
  random = Math.random,
): QueueItem[] {
  const today = startOfDay(now, timeZone);
  const busy = db
    .select({ id: reviewStates.cardId })
    .from(reviewStates)
    .innerJoin(cards, eq(cards.id, reviewStates.cardId))
    .where(
      and(
        eq(cards.userId, userId),
        // Due where it can be shown (so it is in the session's queue), or answered today.
        sql`((${reviewStates.due} <= ${now.getTime()} and ${reviewable}) or ${reviewStates.lastReview} >= ${today.getTime()})`,
      ),
    )
    .all();
  const skip = new Set([...exclude, ...busy.map((r) => r.id)]);
  const rows = db
    .select({ card: cards, state: reviewStates })
    .from(reviewStates)
    .innerJoin(cards, eq(cards.id, reviewStates.cardId))
    .where(
      and(
        eq(cards.userId, userId),
        reviewable,
        gt(reviewStates.due, now),
        lte(cards.introducedAt, today),
        sql`(${reviewStates.mode} in ('speech', 'listening') or (${reviewStates.mode} = 'meaning' and ${cards.kind} = 'phrase'))`,
      ),
    )
    .all()
    .filter((r) => !skip.has(r.card.id));
  const byCard = new Map<number, typeof rows>();
  for (const row of rows) byCard.set(row.card.id, [...(byCard.get(row.card.id) ?? []), row]);
  if (!byCard.size) return [];

  const ids = [...byCard.keys()];
  const skills = wordSkills(db, userId, ids, now);
  const missed = (id: number) => Object.values(skills[id] ?? {}).reduce((sum, t) => sum + t.missed, 0);
  const lastSeen = (id: number) => Math.max(0, ...byCard.get(id)!.map((r) => r.state.lastReview?.getTime() ?? 0));
  const recentFrom = now.getTime() - EXTRA_RECENT_DAYS * DAY;

  const trouble = shuffle(ids.filter((id) => missed(id) > 0), random).sort((a, b) => missed(b) - missed(a));
  const recent = shuffle(ids.filter((id) => (byCard.get(id)![0]!.card.introducedAt?.getTime() ?? 0) >= recentFrom), random);
  // The longest unseen first, shuffled a little so the same few don't always come.
  const oldest = [...ids].sort((a, b) => lastSeen(a) - lastSeen(b));
  const rest = oldest.map((id, i) => ({ id, key: i + random() * 5 })).sort((a, b) => a.key - b.key).map((x) => x.id);

  // Round by round, from the bucket furthest behind its share, so any prefix keeps the mix.
  const buckets = [
    { ids: trouble, share: 1 / 2, taken: 0 },
    { ids: recent, share: 1 / 3, taken: 0 },
    { ids: rest, share: 1 / 6, taken: 0 },
  ];
  const picked: number[] = [];
  const used = new Set<number>();
  const want = Math.min(Math.max(limit, 1), EXTRA_LIMIT);
  while (picked.length < want) {
    const open = buckets.filter((b) => b.ids.some((id) => !used.has(id)));
    if (!open.length) break;
    const next = open.reduce((a, b) => (a.taken / a.share <= b.taken / b.share ? a : b));
    const id = next.ids.find((id) => !used.has(id))!;
    next.taken++;
    used.add(id);
    picked.push(id);
  }

  const items = picked.map((id) => {
    const row = pickWeighted(byCard.get(id)!, (r) => weakness(skills[id], r.state.mode), random);
    return { ...toQueueItem(row), extra: true as const };
  });
  withVoices(db, items);
  withSimilar(db, userId, items.map((i) => i.card));
  return items;
}

/**
 * A miss in extra practice: the mode's review comes forward to `at`, so the next session asks it as
 * a usual review. Nothing else of the schedule changes, and nothing goes into the review log.
 */
export function extraMiss(tx: Pick<Db, "update">, cardId: number, mode: ReviewMode, at: Date): void {
  tx.update(reviewStates)
    .set({ due: at })
    .where(and(eq(reviewStates.cardId, cardId), eq(reviewStates.mode, mode), gt(reviewStates.due, at)))
    .run();
}
