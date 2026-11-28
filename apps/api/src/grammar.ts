// Grammar mode. A construction (-아/어야 하다, -(으)ㄹ 수 있다, -을/를 앞두고) is learned like a new
// word: it waits in a pool in the order added, climbs a short ladder of tasks (understand → pick the
// form → build the sentence → type the form; a miss takes it one step down), waits CHECK_AFTER for
// a check from memory, and then has its own FSRS schedule. Sentences keep only a slot — the
// dictionary form and how it ends — and the app builds the form by rule (@kquiz/korean), so a
// review can use any sentence, and wrong options are real mistakes, not stored ones.
import { build, type Final, type Pos } from "@kquiz/korean";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client.js";
import { grammarAnswers, grammarPoints, grammarSentences, grammarSimilar, grammarStates } from "./db/schema.js";
import { getFsrsSetup, schedulerFor } from "./fsrs.js";
import { applyRating, fromStateRow, newReviewState, toStateRow, type RatingName, type ReviewMode } from "./review.js";

/** Tasks a construction for speaking climbs: understand, pick the form, build, type the form. */
export const LADDER_USE = 4;
/** One only read (news style): understand, pick the form. */
export const LADDER_RECOGNIZE = 2;
/** How many constructions are on the ladder at once. Grammar is heavier than a word. */
export const ACTIVE_POINTS = 2;
export const CHECK_AFTER = 3 * 3_600_000;
export const MAX_SENTENCES = 20;
export const MIN_SENTENCES = 4;
export const MAX_POINTS_PER_CALL = 30;

const GRAMMAR_MODE = "grammar" as unknown as ReviewMode;

export const ladderSteps = (goal: "use" | "recognize") => (goal === "use" ? LADDER_USE : LADDER_RECOGNIZE);

const POS = ["verb", "adjective", "copula", "noun"] as const;
const CLASSES = ["regular", "b", "b-o", "d", "s", "h", "reu", "reo", "u", "l", "eu", "ha"] as const;

const finalSchema = z
  .object({
    style: z.enum(["formal", "polite", "plain"]).optional(),
    tense: z.enum(["present", "past"]).optional(),
    question: z.boolean().optional(),
    ending: z.string().trim().min(1).max(30).optional(),
  })
  .strict();

const text = (max: number) => z.string().trim().min(1).max(max);

export const sentenceSchema = z.object({
  ko: text(300).describe("The sentence with the word in braces in its dictionary form, where the construction goes: 회의에 {가다}."),
  translation: text(300),
  pos: z.enum(POS).optional(),
  cls: z.enum(CLASSES).optional(),
  pattern: text(60).optional(),
  final: finalSchema.optional(),
});

export const grammarSchema = z.object({
  pattern: text(60),
  meaning: text(120),
  goal: z.enum(["use", "recognize"]).default("use"),
  explanation: z.string().trim().max(600).optional(),
  trap: z.string().trim().max(300).optional(),
  tags: z.array(text(40)).max(10).default([]),
  sentences: z.array(sentenceSchema).min(MIN_SENTENCES).max(MAX_SENTENCES),
});

export type GrammarInput = z.input<typeof grammarSchema>;
export type SentenceInput = z.infer<typeof sentenceSchema>;

export interface Slot {
  lemma: string;
  pos: Pos;
  cls?: string;
  pattern: string;
  final: Final;
}

interface ParsedSentence {
  before: string;
  after: string;
  slot: Slot | null;
  translation: string;
  /** The finished sentence, for Claude to check. */
  shown: string;
}

/** Splits "회의에 {가다}." into the slot and its surroundings and builds the form. Throws on a bad one. */
export function parseSentence(input: SentenceInput, pointPattern: string, goal: "use" | "recognize"): ParsedSentence {
  const slots = [...input.ko.matchAll(/\{([^{}]+)\}/g)];
  if (slots.length > 1) throw new Error("at most one {word} per sentence");
  if (!slots.length) {
    if (goal === "use") throw new Error("needs the word in braces, in its dictionary form: {가다}");
    return { before: input.ko, after: "", slot: null, translation: input.translation, shown: input.ko };
  }
  const m = slots[0]!;
  const before = input.ko.slice(0, m.index);
  const after = input.ko.slice(m.index! + m[0].length);
  const lemma = m[1]!.trim();
  const pos: Pos = input.pos ?? "verb";
  if (pos !== "noun" && !/^[가-힣 ]+다$/.test(lemma)) throw new Error(`{${lemma}}: a verb or adjective goes in its dictionary form, ending in 다`);
  const final: Final = { ...input.final };
  if (final.question === undefined && /\?\s*$/.test(after)) final.question = true;
  const slot: Slot = { lemma, pos, ...(input.cls ? { cls: input.cls } : {}), pattern: input.pattern ?? pointPattern, final };
  const form = buildSlot(slot).form;
  return { before, after, slot, translation: input.translation, shown: before + form + after };
}

export function buildSlot(slot: Slot) {
  return build({ lemma: slot.lemma, pos: slot.pos, ...(slot.cls ? { cls: slot.cls as never } : {}) }, slot.pattern, slot.final);
}

export interface GrammarSentenceDto {
  id: number;
  before: string;
  after: string;
  slot: Slot | null;
  translation: string;
}

export type GrammarStatus = "pool" | "learning" | "checking" | "learned";

export interface GrammarPointDto {
  id: number;
  pattern: string;
  meaning: string;
  goal: "use" | "recognize";
  explanation: string | null;
  trap: string | null;
  tags: string[];
  status: GrammarStatus;
  learnStep: number;
  ladder: number;
  /** When a construction up the ladder can be checked. */
  checkAt: string | null;
  due: string | null;
  reps: number;
  lapses: number;
  sentences: GrammarSentenceDto[];
  similar: { id: number; pattern: string; note: string | null }[];
  createdAt: string;
}

type PointRow = typeof grammarPoints.$inferSelect;

function statusOf(p: PointRow): GrammarStatus {
  if (p.learnedAt) return "learned";
  if (p.learnPassedAt) return "checking";
  if (p.learningAt) return "learning";
  return "pool";
}

/** Every construction of the user's with its sentences and schedule, in the order added. */
export function listGrammar(db: Db, userId: number, ids?: number[]): GrammarPointDto[] {
  const where = ids ? and(eq(grammarPoints.userId, userId), inArray(grammarPoints.id, ids)) : eq(grammarPoints.userId, userId);
  const points = db.select().from(grammarPoints).where(where).orderBy(asc(grammarPoints.createdAt), asc(grammarPoints.id)).all();
  if (!points.length) return [];
  const pointIds = points.map((p) => p.id);
  const sentences = db.select().from(grammarSentences).where(inArray(grammarSentences.pointId, pointIds)).orderBy(asc(grammarSentences.id)).all();
  const states = db.select().from(grammarStates).where(inArray(grammarStates.pointId, pointIds)).all();
  const links = db
    .select()
    .from(grammarSimilar)
    .where(sql`${grammarSimilar.pointId} in ${pointIds} or ${grammarSimilar.otherId} in ${pointIds}`)
    .all();
  const patterns = new Map(db.select({ id: grammarPoints.id, pattern: grammarPoints.pattern }).from(grammarPoints).where(eq(grammarPoints.userId, userId)).all().map((p) => [p.id, p.pattern]));
  const stateOf = new Map(states.map((s) => [s.pointId, s]));
  return points.map((p) => {
    const state = stateOf.get(p.id);
    return {
      id: p.id,
      pattern: p.pattern,
      meaning: p.meaning,
      goal: p.goal,
      explanation: p.explanation,
      trap: p.trap,
      tags: p.tags,
      status: statusOf(p),
      learnStep: p.learnStep,
      ladder: ladderSteps(p.goal),
      checkAt: p.learnPassedAt && !p.learnedAt ? new Date(p.learnPassedAt.getTime() + CHECK_AFTER).toISOString() : null,
      due: state ? state.due.toISOString() : null,
      reps: state?.reps ?? 0,
      lapses: state?.lapses ?? 0,
      sentences: sentences
        .filter((s) => s.pointId === p.id)
        .map((s) => ({
          id: s.id,
          before: s.before,
          after: s.after,
          translation: s.translation,
          slot: s.lemma
            ? { lemma: s.lemma, pos: (s.pos ?? "verb") as Pos, ...(s.cls ? { cls: s.cls } : {}), pattern: s.pattern ?? p.pattern, final: (s.final ?? {}) as Final }
            : null,
        })),
      similar: links
        .filter((l) => l.pointId === p.id || l.otherId === p.id)
        .map((l) => {
          const other = l.pointId === p.id ? l.otherId : l.pointId;
          return { id: other, pattern: patterns.get(other) ?? "", note: l.note };
        }),
      createdAt: p.createdAt.toISOString(),
    };
  });
}

export interface AddResult {
  created: { id: number; pattern: string; sentences: string[] }[];
  duplicates: { id: number; pattern: string }[];
  rejected: { pattern: string; reason: string }[];
}

function parseAll(input: z.infer<typeof grammarSchema>): ParsedSentence[] {
  return input.sentences.map((s, i) => {
    try {
      return parseSentence(s, input.pattern, input.goal);
    } catch (e) {
      throw new Error(`sentence ${i + 1}: ${(e as Error).message}`);
    }
  });
}

function insertSentences(db: Pick<Db, "insert">, pointId: number, pointPattern: string, sentences: ParsedSentence[], now: Date) {
  if (!sentences.length) return;
  db.insert(grammarSentences)
    .values(
      sentences.map((s) => ({
        pointId,
        before: s.before,
        after: s.after,
        lemma: s.slot?.lemma ?? null,
        pos: s.slot?.pos ?? null,
        cls: s.slot?.cls ?? null,
        // Kept only when it differs, so renaming the point's pattern carries over.
        pattern: s.slot && s.slot.pattern !== pointPattern ? s.slot.pattern : null,
        final: s.slot ? (s.slot.final as Record<string, unknown>) : null,
        translation: s.translation,
        createdAt: now,
      })),
    )
    .run();
}

/** Adds constructions to the pool. A pattern the user already has is a duplicate, not an update. */
export function addGrammar(db: Db, userId: number, inputs: unknown[], now = new Date()): AddResult {
  const result: AddResult = { created: [], duplicates: [], rejected: [] };
  for (const raw of inputs) {
    const parsed = grammarSchema.safeParse(raw);
    const pattern = typeof (raw as { pattern?: unknown })?.pattern === "string" ? (raw as { pattern: string }).pattern : "?";
    if (!parsed.success) {
      result.rejected.push({ pattern, reason: z.prettifyError(parsed.error) });
      continue;
    }
    const input = parsed.data;
    const existing = db
      .select({ id: grammarPoints.id })
      .from(grammarPoints)
      .where(and(eq(grammarPoints.userId, userId), eq(grammarPoints.pattern, input.pattern)))
      .get();
    if (existing) {
      result.duplicates.push({ id: existing.id, pattern: input.pattern });
      continue;
    }
    let sentences: ParsedSentence[];
    try {
      sentences = parseAll(input);
    } catch (e) {
      result.rejected.push({ pattern: input.pattern, reason: (e as Error).message });
      continue;
    }
    // Spread out by a millisecond so the pool keeps the order of the call.
    const at = new Date(now.getTime() + result.created.length);
    const id = db.transaction((tx) => {
      const row = tx
        .insert(grammarPoints)
        .values({
          userId,
          pattern: input.pattern,
          meaning: input.meaning,
          goal: input.goal,
          explanation: input.explanation || null,
          trap: input.trap || null,
          tags: [...new Set(input.tags.map((t) => t.toLowerCase()))],
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: grammarPoints.id })
        .get();
      insertSentences(tx, row.id, input.pattern, sentences, at);
      return row.id;
    });
    result.created.push({ id, pattern: input.pattern, sentences: sentences.map((s) => s.shown) });
  }
  return result;
}

export const grammarPatchSchema = grammarSchema.partial().extend({ sentences: grammarSchema.shape.sentences.optional() });

/** Changes the given fields; sentences, when given, replace the old ones. */
export function updateGrammar(db: Db, userId: number, id: number, raw: unknown, now = new Date()): { ok: true; sentences?: string[] } | { ok: false; reason: string } {
  const parsed = grammarPatchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: z.prettifyError(parsed.error) };
  const point = db.select().from(grammarPoints).where(and(eq(grammarPoints.userId, userId), eq(grammarPoints.id, id))).get();
  if (!point) return { ok: false, reason: "not found" };
  const patch = parsed.data;
  const pattern = patch.pattern ?? point.pattern;
  const goal = patch.goal ?? point.goal;
  let sentences: ParsedSentence[] | undefined;
  try {
    if (patch.sentences) sentences = parseAll({ ...patch, pattern, goal, meaning: "", tags: [], sentences: patch.sentences });
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (patch.pattern && patch.pattern !== point.pattern) {
    const clash = db.select({ id: grammarPoints.id }).from(grammarPoints).where(and(eq(grammarPoints.userId, userId), eq(grammarPoints.pattern, patch.pattern))).get();
    if (clash) return { ok: false, reason: `the user already has ${patch.pattern}` };
  }
  db.transaction((tx) => {
    tx.update(grammarPoints)
      .set({
        pattern,
        goal,
        ...(patch.meaning !== undefined ? { meaning: patch.meaning } : {}),
        ...(patch.explanation !== undefined ? { explanation: patch.explanation || null } : {}),
        ...(patch.trap !== undefined ? { trap: patch.trap || null } : {}),
        ...(patch.tags ? { tags: [...new Set(patch.tags.map((t) => t.toLowerCase()))] } : {}),
        updatedAt: now,
      })
      .where(eq(grammarPoints.id, id))
      .run();
    if (sentences) {
      tx.delete(grammarSentences).where(eq(grammarSentences.pointId, id)).run();
      insertSentences(tx, id, pattern, sentences, now);
    }
  });
  return { ok: true, ...(sentences ? { sentences: sentences.map((s) => s.shown) } : {}) };
}

export interface SimilarGrammarPair {
  pattern: string;
  other: string;
  note?: string;
  remove?: boolean;
}

export function linkSimilarGrammar(db: Db, userId: number, pairs: SimilarGrammarPair[]) {
  const ids = new Map(db.select({ id: grammarPoints.id, pattern: grammarPoints.pattern }).from(grammarPoints).where(eq(grammarPoints.userId, userId)).all().map((p) => [p.pattern, p.id]));
  const linked: string[][] = [];
  const unlinked: string[][] = [];
  const rejected: { pattern: string; other: string; reason: string }[] = [];
  for (const pair of pairs) {
    const a = ids.get(pair.pattern);
    const b = ids.get(pair.other);
    if (!a || !b || a === b) {
      rejected.push({ pattern: pair.pattern, other: pair.other, reason: a === b && a ? "the same construction" : "not found" });
      continue;
    }
    const [pointId, otherId] = a < b ? [a, b] : [b, a];
    if (pair.remove) {
      db.delete(grammarSimilar).where(and(eq(grammarSimilar.pointId, pointId), eq(grammarSimilar.otherId, otherId))).run();
      unlinked.push([pair.pattern, pair.other]);
    } else {
      db.insert(grammarSimilar)
        .values({ pointId, otherId, note: pair.note ?? null })
        .onConflictDoUpdate({ target: [grammarSimilar.pointId, grammarSimilar.otherId], set: { note: pair.note ?? null } })
        .run();
      linked.push([pair.pattern, pair.other]);
    }
  }
  return { linked, unlinked, rejected };
}

/** Takes constructions from the pool onto the ladder, up to ACTIVE_POINTS at once. */
export function startLearning(db: Db, userId: number, id: number, now = new Date()): { ok: boolean; reason?: string } {
  const point = db.select().from(grammarPoints).where(and(eq(grammarPoints.userId, userId), eq(grammarPoints.id, id))).get();
  if (!point) return { ok: false, reason: "not_found" };
  if (point.learningAt) return { ok: true };
  const active = db
    .select({ n: sql<number>`count(*)` })
    .from(grammarPoints)
    .where(and(eq(grammarPoints.userId, userId), sql`${grammarPoints.learningAt} is not null and ${grammarPoints.learnPassedAt} is null and ${grammarPoints.learnedAt} is null`))
    .get()!.n;
  if (active >= ACTIVE_POINTS) return { ok: false, reason: "ladder_full" };
  db.update(grammarPoints).set({ learningAt: now, learnStep: 0, updatedAt: now }).where(eq(grammarPoints.id, id)).run();
  return { ok: true };
}

export const answerSchema = z.object({
  id: z.uuid(),
  pointId: z.number().int().positive(),
  sentenceId: z.number().int().positive().optional(),
  task: z.enum(["understand", "choose", "build", "type", "drill", "contrast"]),
  phase: z.enum(["learn", "check", "review", "fix", "extra"]),
  outcome: z.enum(["right", "soft", "wrong"]),
  cls: z.enum(CLASSES).optional(),
  answeredAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  elapsedMs: z.number().int().min(0).max(3_600_000).optional(),
});
export type GrammarAnswer = z.infer<typeof answerSchema>;

const ratingFor = (outcome: GrammarAnswer["outcome"]): RatingName => (outcome === "right" ? "good" : outcome === "soft" ? "hard" : "again");

/**
 * Records answers and moves each construction on: up or down its ladder, through its check into
 * reviews, or along its schedule. Answers already recorded (same id) are skipped.
 */
export function applyAnswers(db: Db, userId: number, answers: GrammarAnswer[]): { applied: number } {
  const scheduler = schedulerFor(getFsrsSetup(db, userId, GRAMMAR_MODE));
  let applied = 0;
  db.transaction((tx) => {
    for (const a of [...answers].sort((x, y) => x.answeredAt.getTime() - y.answeredAt.getTime())) {
      const point = tx.select().from(grammarPoints).where(and(eq(grammarPoints.userId, userId), eq(grammarPoints.id, a.pointId))).get();
      if (!point) continue;
      const inserted = tx
        .insert(grammarAnswers)
        .values({ id: a.id, userId, pointId: a.pointId, sentenceId: a.sentenceId ?? null, task: a.task, phase: a.phase, outcome: a.outcome, cls: a.cls ?? null, answeredAt: a.answeredAt, elapsedMs: a.elapsedMs ?? null })
        .onConflictDoNothing()
        .returning({ id: grammarAnswers.id })
        .get();
      if (!inserted) continue;
      applied++;
      const at = a.answeredAt;
      const ladder = ladderSteps(point.goal);
      if (a.phase === "learn" && point.learningAt && !point.learnPassedAt && !point.learnedAt) {
        const step = a.outcome === "wrong" ? Math.max(0, point.learnStep - 1) : point.learnStep + 1;
        tx.update(grammarPoints)
          .set({ learnStep: Math.min(step, ladder), learnPassedAt: step >= ladder ? at : null, updatedAt: at })
          .where(eq(grammarPoints.id, point.id))
          .run();
      } else if (a.phase === "check" && point.learnPassedAt && !point.learnedAt) {
        if (a.outcome === "wrong") {
          tx.update(grammarPoints).set({ learnStep: ladder - 1, learnPassedAt: null, updatedAt: at }).where(eq(grammarPoints.id, point.id)).run();
        } else {
          const state = toStateRow(applyRating(newReviewState(at), ratingFor(a.outcome), at, scheduler));
          tx.insert(grammarStates).values({ pointId: point.id, ...state }).onConflictDoUpdate({ target: grammarStates.pointId, set: state }).run();
          tx.update(grammarPoints).set({ learnedAt: at, updatedAt: at }).where(eq(grammarPoints.id, point.id)).run();
        }
      } else if (a.phase === "review" && point.learnedAt) {
        const row = tx.select().from(grammarStates).where(eq(grammarStates.pointId, point.id)).get();
        if (!row) continue;
        const state = toStateRow(applyRating(fromStateRow(row), ratingFor(a.outcome), at, scheduler));
        tx.update(grammarStates).set(state).where(eq(grammarStates.pointId, point.id)).run();
      }
    }
  });
  return { applied };
}

export interface GrammarStats {
  total: number;
  learned: number;
  learning: number;
  checking: number;
  pool: number;
  dueNow: number;
  /** Share right on the first try per kind of task, over the last 60 days. */
  tasks: { task: string; answers: number; right: number }[];
  /** The same per conjugation class of the word in the slot: where the user slips. */
  classes: { cls: string; answers: number; right: number }[];
  /** The constructions missed most in the last 60 days. */
  missed: { id: number; pattern: string; meaning: string; wrong: number; answers: number }[];
  /** Learned constructions so far, at the end of each of the last 15 days and today. */
  learnedDays: { day: string; learned: number }[];
}

const DAY = 86_400_000;

export function grammarStats(db: Db, userId: number, now = new Date()): GrammarStats {
  const points = db.select().from(grammarPoints).where(eq(grammarPoints.userId, userId)).all();
  const due = db
    .select({ n: sql<number>`count(*)` })
    .from(grammarStates)
    .innerJoin(grammarPoints, eq(grammarPoints.id, grammarStates.pointId))
    .where(and(eq(grammarPoints.userId, userId), sql`${grammarStates.due} <= ${now.getTime()}`))
    .get()!.n;
  const since = now.getTime() - 60 * DAY;
  const counted = sql`${grammarAnswers.userId} = ${userId} and ${grammarAnswers.answeredAt} >= ${since} and ${grammarAnswers.phase} in ('learn', 'check', 'review')`;
  const right = sql<number>`sum(case when ${grammarAnswers.outcome} = 'wrong' then 0 else 1 end)`;
  const tasks = db.select({ task: grammarAnswers.task, answers: sql<number>`count(*)`, right }).from(grammarAnswers).where(counted).groupBy(grammarAnswers.task).all();
  const classes = db
    .select({ cls: grammarAnswers.cls, answers: sql<number>`count(*)`, right })
    .from(grammarAnswers)
    .where(sql`${counted} and ${grammarAnswers.cls} is not null`)
    .groupBy(grammarAnswers.cls)
    .all();
  const missed = db
    .select({ id: grammarAnswers.pointId, wrong: sql<number>`sum(case when ${grammarAnswers.outcome} = 'wrong' then 1 else 0 end)`, answers: sql<number>`count(*)` })
    .from(grammarAnswers)
    .where(counted)
    .groupBy(grammarAnswers.pointId)
    .all()
    .filter((m) => m.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || a.answers - b.answers)
    .slice(0, 10);
  const byId = new Map(points.map((p) => [p.id, p]));
  const learnedAt = points.map((p) => p.learnedAt?.getTime()).filter((t): t is number => t !== undefined);
  const learnedDays = Array.from({ length: 16 }, (_, i) => {
    const end = new Date(now.getTime() - (15 - i) * DAY);
    return { day: end.toISOString().slice(0, 10), learned: learnedAt.filter((t) => t <= end.getTime()).length };
  });
  const count = (s: GrammarStatus) => points.filter((p) => statusOf(p) === s).length;
  return {
    total: points.length,
    learned: count("learned"),
    learning: count("learning"),
    checking: count("checking"),
    pool: count("pool"),
    dueNow: due,
    tasks: tasks.map((t) => ({ task: t.task, answers: t.answers, right: t.right })),
    classes: classes.map((c) => ({ cls: c.cls!, answers: c.answers, right: c.right })),
    missed: missed.map((m) => ({ id: m.id, pattern: byId.get(m.id)?.pattern ?? "", meaning: byId.get(m.id)?.meaning ?? "", wrong: m.wrong, answers: m.answers })),
    learnedDays,
  };
}

/** For Claude: constructions matching a text or tag, each sentence shown finished. */
export function findGrammar(db: Db, userId: number, query: { text?: string; tag?: string; limit: number }) {
  const needle = query.text?.toLocaleLowerCase();
  return listGrammar(db, userId)
    .filter((p) => !needle || p.pattern.toLocaleLowerCase().includes(needle) || p.meaning.toLocaleLowerCase().includes(needle))
    .filter((p) => !query.tag || p.tags.includes(query.tag.toLowerCase()))
    .slice(-query.limit)
    .map(({ sentences, ...p }) => ({
      ...p,
      sentences: sentences.map((s) => ({
        ko: s.slot ? `${s.before}{${s.slot.lemma}}${s.after}` : s.before,
        shown: s.slot ? s.before + buildSlot(s.slot).form + s.after : s.before,
        translation: s.translation,
        ...(s.slot && s.slot.pos !== "verb" ? { pos: s.slot.pos } : {}),
        ...(s.slot?.cls ? { cls: s.slot.cls } : {}),
        ...(s.slot && s.slot.pattern !== p.pattern ? { pattern: s.slot.pattern } : {}),
        ...(s.slot && Object.keys(s.slot.final).length ? { final: s.slot.final } : {}),
      })),
    }));
}
