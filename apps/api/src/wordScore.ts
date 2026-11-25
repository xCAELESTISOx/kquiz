import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { cards, reviewStates, taskAnswers } from "./db/schema.js";
import { SKILL_OF, type Skill, type TaskPhase } from "./taskStats.js";

/**
 * How well each word is known, as points from its answers (research/word-score.md). FSRS decides
 * when a word comes; this is for the statistics, the word's colour and choosing words to practise.
 *
 * The rules, so that it is honest:
 * - A right first try earns by how hard the task is (GAIN): picking is easier than writing. Right
 *   with a hint, slowly or with a slip earns half, and so does extra practice off the schedule.
 *   Remembered after a week or more unseen, it earns BREAK_BONUS on top.
 * - A miss always costs MISS, more than any task earns, at most MISS_CAP a session.
 * - After a miss, the rest of that session (going over mistakes, extra practice included) earns at
 *   most AFTER_MISS_GAIN a task and gives back at most half of what was lost: a session with a
 *   miss always ends lower than it began.
 * - A session earns a word at most SESSION_CAP, so practising a word over and over gets nothing.
 * - Points stay in 0…MAX and don't melt with time (a long FSRS interval means the word is known);
 *   `fading` says FSRS would rather have it checked now.
 * - "Known" and up takes more than points: the last answer in every way the word is reviewed (its
 *   meaning, giving the Korean, by ear) was right, and a session without a miss came after the last
 *   miss. So a word missed today can't turn green today. A word still on its learning ladder is
 *   "learning" at most.
 * Everything is worked out from `task_answers` each time, so the rules can change and all follows.
 */
export const GAIN: Record<Skill, number> = { choose: 1, build: 1, recall: 2, listen: 2, write: 3, dictation: 3, speak: 3 };
export const MISS = 4;
export const MISS_CAP = 8;
export const AFTER_MISS_GAIN = 1;
export const SESSION_CAP = 6;
export const BREAK_DAYS = 7;
export const BREAK_BONUS = 1;
export const MAX = 20;
/** Below this chance of recalling the word now (FSRS), it is fading. */
export const FADING_BELOW = 0.8;

export const LEVELS = ["new", "learning", "familiar", "known", "solid"] as const;
export type Level = (typeof LEVELS)[number];
/** The lowest points of each level from "learning" up. */
const FROM: Record<Exclude<Level, "new">, number> = { learning: 0, familiar: 6, known: 12, solid: 18 };

/** The three ways a word is asked: its meaning (ko→ru), giving the Korean (ru→ko), by ear. */
export const DIRECTIONS = ["meaning", "say", "ear"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const DIRECTION_OF: Record<Skill, Direction> = {
  recall: "meaning",
  choose: "say",
  build: "say",
  write: "say",
  speak: "say",
  listen: "ear",
  dictation: "ear",
};

const WAY_OF_MODE: Record<"meaning" | "speech" | "listening", Direction> = { meaning: "meaning", speech: "say", listening: "ear" };

export type Answer = {
  logId: string;
  n: number;
  task: string;
  phase: TaskPhase | null;
  missed: boolean;
  soft: boolean;
  recovered: boolean;
  answeredAt: Date;
};

export type WordScore = {
  score: number;
  level: Level;
  /** How the last answer in each way went (a way never asked is left out). */
  last: Partial<Record<Direction, "right" | "missed">>;
  answers: number;
  fading?: true;
};

const DAY = 86_400_000;

/** Points and level from one word's answers, oldest first. */
export function scoreAnswers(
  answers: Answer[],
  { learned = true, fading = false, ways: asked = [] as Direction[] } = {},
): WordScore {
  let score = 0;
  let counted = 0;
  const last: WordScore["last"] = {};
  let missedEver = false;
  let cleanSince = 0;
  let prevAt: number | undefined;
  const sorted = [...answers].sort((a, b) => a.answeredAt.getTime() - b.answeredAt.getTime() || a.n - b.n);
  for (let i = 0; i < sorted.length; ) {
    const logId = sorted[i]!.logId;
    let gained = 0;
    let lost = 0;
    let given = 0;
    let missedHere = false;
    for (; i < sorted.length && sorted[i]!.logId === logId; i++) {
      const a = sorted[i]!;
      const skill = SKILL_OF[a.task];
      if (!skill) continue;
      const at = a.answeredAt.getTime();
      const gap = prevAt === undefined ? 0 : (at - prevAt) / DAY;
      prevAt = at;
      counted++;
      const phase = a.phase ?? "main";
      // Going over mistakes repeats what was just shown: it puts nothing right in the word's record.
      if (phase !== "fix") last[DIRECTION_OF[skill]] = a.missed ? "missed" : "right";
      if (a.missed) {
        const before = score;
        score = Math.max(0, score - Math.min(MISS, MISS_CAP - lost));
        lost += before - score;
        missedHere = true;
        missedEver = true;
        if (!a.recovered) continue;
      }
      let gain = a.missed ? AFTER_MISS_GAIN : GAIN[skill];
      if (!a.missed) {
        if (a.soft) gain /= 2;
        if (phase === "extra") gain /= 2;
        if (gap >= BREAK_DAYS && phase === "main") gain += BREAK_BONUS;
      }
      if (missedHere) gain = Math.min(gain, AFTER_MISS_GAIN, Math.floor(lost / 2) - given);
      // Going over mistakes without one in this session (a miss on a new word's ladder was logged elsewhere) earns nothing.
      if (phase === "fix" && !missedHere) gain = 0;
      gain = Math.max(0, Math.min(gain, SESSION_CAP - gained, MAX - score));
      score += gain;
      gained += gain;
      if (missedHere) given += gain;
    }
    if (missedHere) cleanSince = 0;
    else if (missedEver) cleanSince++;
  }

  let level: Level = counted ? "learning" : "new";
  for (const l of ["familiar", "known", "solid"] as const) if (score >= FROM[l]) level = l;
  // Every way the word was asked last went right, and it was asked in at least two ways if it is reviewed in two.
  const ways = Object.values(last);
  // (A phrase's meaning is built from blocks, so ways are counted, not matched to its modes.)
  const allRight = ways.length >= Math.max(1, Math.min(2, new Set(asked).size)) && ways.every((w) => w === "right");
  const proven = allRight && (!missedEver || cleanSince > 0);
  if ((level === "known" || level === "solid") && !proven) level = "familiar";
  if (!learned && level !== "new") level = "learning";
  return { score: Math.round(score * 10) / 10, level, last, answers: counted, ...(fading ? { fading: true as const } : {}) };
}

/** FSRS's chance of recalling after `days` at `stability` (its power forgetting curve). */
export function recallChance(days: number, stability: number): number {
  return (1 + (19 / 81) * (days / stability)) ** -0.5;
}

/** Scores of the user's words: these `cardIds`, or all of them. */
export function wordScores(db: Db, userId: number, now: Date, cardIds?: number[]): Record<number, WordScore> {
  const owned = db
    .select({ id: cards.id, introducedAt: cards.introducedAt })
    .from(cards)
    .where(and(eq(cards.userId, userId), cardIds ? inArray(cards.id, [...new Set(cardIds)]) : undefined))
    .all();
  if (!owned.length) return {};
  const ids = owned.map((c) => c.id);
  const answers = new Map<number, Answer[]>();
  const rows = db
    .select()
    .from(taskAnswers)
    .where(and(eq(taskAnswers.userId, userId), cardIds ? inArray(taskAnswers.cardId, ids) : undefined))
    .all();
  for (const row of rows) answers.set(row.cardId, [...(answers.get(row.cardId) ?? []), row]);
  const fading = new Set<number>();
  const ways = new Map<number, Direction[]>();
  const states = db
    .select({ cardId: reviewStates.cardId, mode: reviewStates.mode, stability: reviewStates.stability, lastReview: reviewStates.lastReview })
    .from(reviewStates)
    .innerJoin(cards, eq(cards.id, reviewStates.cardId))
    .where(and(eq(cards.userId, userId), cardIds ? inArray(reviewStates.cardId, ids) : undefined))
    .all();
  for (const s of states) {
    ways.set(s.cardId, [...(ways.get(s.cardId) ?? []), WAY_OF_MODE[s.mode]]);
    if (!s.lastReview || s.stability <= 0) continue;
    const days = Math.max(0, now.getTime() - s.lastReview.getTime()) / DAY;
    if (recallChance(days, s.stability) < FADING_BELOW) fading.add(s.cardId);
  }
  const out: Record<number, WordScore> = {};
  for (const c of owned) out[c.id] = scoreAnswers(answers.get(c.id) ?? [], { learned: !!c.introducedAt, fading: fading.has(c.id), ways: ways.get(c.id) ?? [] });
  return out;
}

/** How many of the user's words stand at each level (paused ones left out). */
export function levelCounts(db: Db, userId: number, now: Date): Record<Level, number> {
  const paused = new Set(
    db
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.userId, userId), eq(cards.suspended, true)))
      .all()
      .map((c) => c.id),
  );
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<Level, number>;
  for (const [id, s] of Object.entries(wordScores(db, userId, now))) if (!paused.has(Number(id))) counts[s.level]++;
  return counts;
}
