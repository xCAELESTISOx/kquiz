import { and, eq } from "drizzle-orm";
import { default_w, fsrs, type FSRS } from "ts-fsrs";
import type { Db } from "./db/client.js";
import { fsrsSettings } from "./db/schema.js";
import type { ReviewMode } from "./review.js";

export const DEFAULT_RETENTION = 0.9;
/** Lower retention means fewer reviews and more forgetting; outside this range FSRS works poorly. */
export const RETENTION_RANGE = { min: 0.85, max: 0.95 } as const;

export type FsrsSetup = { desiredRetention: number; weights: number[] | null };

type Reader = Pick<Db, "select">;

export function getFsrsSetup(db: Reader, userId: number, mode: ReviewMode): FsrsSetup {
  const row = db
    .select()
    .from(fsrsSettings)
    .where(and(eq(fsrsSettings.userId, userId), eq(fsrsSettings.mode, mode)))
    .get();
  return { desiredRetention: row?.desiredRetention ?? DEFAULT_RETENTION, weights: row?.weights ?? null };
}

export function setDesiredRetention(db: Db, userId: number, mode: ReviewMode, retention: number) {
  db.insert(fsrsSettings)
    .values({ userId, mode, desiredRetention: retention })
    .onConflictDoUpdate({ target: [fsrsSettings.userId, fsrsSettings.mode], set: { desiredRetention: retention } })
    .run();
}

/** The weights reviews are scheduled with: the owner's own once fitted, FSRS defaults until then. */
export function currentWeights(setup: FsrsSetup): number[] {
  return setup.weights ?? [...default_w];
}

const cache = new Map<string, FSRS>();

export function schedulerFor(setup: FsrsSetup, fuzz = true): FSRS {
  const key = JSON.stringify([setup.desiredRetention, setup.weights, fuzz]);
  let scheduler = cache.get(key);
  if (!scheduler) {
    scheduler = fsrs({ w: currentWeights(setup), request_retention: setup.desiredRetention, enable_fuzz: fuzz });
    if (cache.size > 16) cache.clear();
    cache.set(key, scheduler);
  }
  return scheduler;
}
