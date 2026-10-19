import { sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { attempts, phoneStats } from "./db/schema.js";
import type { ScoreResult } from "./scorer.js";

/**
 * Saves a scored attempt on one of `userId`'s cards and counts every expected sound in the weak-sounds stats.
 * Only "wrong" sounds count as errors there: "weak" is too often a false flag to steer practice by.
 */
export function recordAttempt(db: Db, userId: number, cardId: number, result: ScoreResult, now = new Date()): number {
  const errorsByPhone = new Map<string, number>();
  for (const error of result.errors) {
    if (error.status !== "wrong" || !error.expected) continue;
    errorsByPhone.set(error.expected.ipa, (errorsByPhone.get(error.expected.ipa) ?? 0) + 1);
  }
  const attemptsByPhone = new Map<string, number>();
  for (const phone of result.target_phones) attemptsByPhone.set(phone, (attemptsByPhone.get(phone) ?? 0) + 1);

  return db.transaction((tx) => {
    const row = tx
      .insert(attempts)
      .values({
        cardId,
        createdAt: now,
        score: result.score,
        targetPhones: result.target_phones,
        heardPhones: result.heard_phones,
        syllables: result.syllables,
        errors: result.errors,
      })
      .returning({ id: attempts.id })
      .get();
    for (const [phone, n] of attemptsByPhone) {
      const errors = Math.min(errorsByPhone.get(phone) ?? 0, n);
      tx.insert(phoneStats)
        .values({ userId, phone, attempts: n, errors, lastSeen: now })
        .onConflictDoUpdate({
          target: [phoneStats.userId, phoneStats.phone],
          set: {
            attempts: sql`${phoneStats.attempts} + ${n}`,
            errors: sql`${phoneStats.errors} + ${errors}`,
            lastSeen: now,
          },
        })
        .run();
    }
    return row.id;
  });
}
