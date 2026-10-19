// People who can sign in (docs/PLAN.md, multi-user). The owner runs the server and invites others;
// a member gets their own cards, schedule, stats and Claude connector, and limits that keep one
// member from taking the server's CPU and disk from everyone else.
import { and, count, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { attempts, cards, users } from "./db/schema.js";

/** Made by migration 0008; everything stored before it is theirs. */
export const OWNER_ID = 1;
/** Everyone together, the owner included; invites stop working at this many. */
export const MAX_USERS = 5;

/** What a member may do; the owner has no limits. */
export const MEMBER_LIMITS = {
  /** Cards added in any 24 hours: each one costs a TTS run. */
  cardsPerDay: 200,
  cards: 5000,
  /** Scored recordings in any 24 hours: each one is a few seconds of scorer CPU. */
  scoresPerDay: 300,
} as const;

const DAY = 86_400_000;

export type User = typeof users.$inferSelect;
export type Role = User["role"];

type Reader = Pick<Db, "select">;

export function getUser(db: Reader, id: number): User | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

/** The user, unless they were disabled. */
export function activeUser(db: Reader, id: number): User | undefined {
  return db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.disabledAt)))
    .get();
}

export function countUsers(db: Reader): number {
  return db.select({ n: count() }).from(users).get()?.n ?? 0;
}

/** Too many new things for a member: the request is refused whole, nothing is stored. */
export class QuotaError extends Error {
  constructor(
    readonly what: "cards" | "scores",
    /** How many more are allowed right now. */
    readonly left: number,
  ) {
    super(
      what === "cards"
        ? `Card limit reached: ${left} more can be added now (${MEMBER_LIMITS.cardsPerDay} a day, ${MEMBER_LIMITS.cards} in total)`
        : `Pronunciation check limit reached (${MEMBER_LIMITS.scoresPerDay} a day)`,
    );
  }
}

const isOwner = (db: Reader, userId: number) => getUser(db, userId)?.role === "owner";

/** Cards the user may still add now; Infinity for the owner. */
export function cardsLeft(db: Reader, userId: number, now: Date): number {
  if (isOwner(db, userId)) return Infinity;
  const total = db.select({ n: count() }).from(cards).where(eq(cards.userId, userId)).get()?.n ?? 0;
  const today =
    db
      .select({ n: count() })
      .from(cards)
      .where(and(eq(cards.userId, userId), gte(cards.createdAt, new Date(now.getTime() - DAY))))
      .get()?.n ?? 0;
  return Math.max(0, Math.min(MEMBER_LIMITS.cards - total, MEMBER_LIMITS.cardsPerDay - today));
}

/** Throws QuotaError when a member is out of pronunciation checks for the day. */
export function checkScoreQuota(db: Reader, userId: number, now: Date) {
  if (isOwner(db, userId)) return;
  const recent =
    db
      .select({ n: count() })
      .from(attempts)
      .innerJoin(cards, eq(cards.id, attempts.cardId))
      .where(and(eq(cards.userId, userId), gte(attempts.createdAt, new Date(now.getTime() - DAY))))
      .get()?.n ?? 0;
  if (recent >= MEMBER_LIMITS.scoresPerDay) throw new QuotaError("scores", 0);
}
