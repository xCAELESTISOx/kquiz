// Practice outside the review queues: shadowing the cards' example sentences and listening drills
// on similar sounds. Neither changes a schedule; drills only count right and wrong answers.
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeKorean } from "./cards.js";
import type { Db } from "./db/client.js";
import { cards, reviewStates, soundDrills, speechAudio } from "./db/schema.js";
import { EXTRA_VOICES, voicesFor, type ExtraVoice } from "./voices.js";

// ---- Reference audio for example sentences and drill words ----

/** Every text that should have audio, for all users: drill words first (they are short and few), then examples. */
export function wantedSpeechTexts(db: Db): string[] {
  const texts = new Set<string>();
  for (const drill of db.select({ words: soundDrills.words }).from(soundDrills).orderBy(asc(soundDrills.id)).all()) {
    for (const word of drill.words) texts.add(word.korean);
  }
  for (const card of db.select({ examples: cards.examples }).from(cards).orderBy(asc(cards.id)).all()) {
    for (const example of card.examples) texts.add(example.ko);
  }
  return [...texts];
}

/** The first wanted text without audio, skipping `skip`. */
export function nextTextWithoutAudio(db: Db, skip: Set<string> = new Set()): string | undefined {
  const wanted = wantedSpeechTexts(db).filter((text) => !skip.has(text));
  // Chunks keep the IN list well under SQLite's variable limit.
  for (let i = 0; i < wanted.length; i += 500) {
    const chunk = wanted.slice(i, i + 500);
    const have = new Set(
      db.select({ text: speechAudio.text }).from(speechAudio).where(inArray(speechAudio.text, chunk)).all().map((r) => r.text),
    );
    const missing = chunk.find((text) => !have.has(text));
    if (missing) return missing;
  }
  return undefined;
}

export function saveSpeechAudio(db: Db, text: string, data: Uint8Array, now: Date) {
  const values = { mime: "audio/mpeg", data: Buffer.from(data), createdAt: now };
  db.insert(speechAudio)
    .values({ text, ...values })
    .onConflictDoUpdate({ target: speechAudio.text, set: values })
    .run();
}

export function getSpeechAudio(db: Db, text: string) {
  const row = db.select().from(speechAudio).where(eq(speechAudio.text, text)).get();
  return row && { data: row.data, mime: row.mime, etag: `"t-${row.createdAt.getTime()}-${row.data.length}"` };
}

// ---- Shadowing ----

export type ShadowItem = { cardId: number; word: string; meaning: string; ko: string; ru: string };

/**
 * Example sentences to repeat after the reference, at most one per card and only those with audio,
 * since the intonation curve needs it. Cards already studied come first, in random order.
 */
export function shadowingItems(db: Db, userId: number, limit: number, random = Math.random): ShadowItem[] {
  const studied = new Set(
    db
      .selectDistinct({ cardId: reviewStates.cardId })
      .from(reviewStates)
      .innerJoin(cards, eq(cards.id, reviewStates.cardId))
      .where(and(eq(cards.userId, userId), gt(reviewStates.reps, 0)))
      .all()
      .map((r) => r.cardId),
  );
  const voiced = new Set(db.select({ text: speechAudio.text }).from(speechAudio).all().map((r) => r.text));
  const candidates = db
    .select({ id: cards.id, korean: cards.korean, meaning: cards.meaning, examples: cards.examples })
    .from(cards)
    .where(and(eq(cards.userId, userId), sql`json_array_length(${cards.examples}) > 0`))
    .all()
    .map((card) => {
      const examples = card.examples.filter((e) => voiced.has(e.ko));
      const example = examples[Math.floor(random() * examples.length)];
      return example && { item: { cardId: card.id, word: card.korean, meaning: card.meaning, ...example }, order: (studied.has(card.id) ? 0 : 1) + random() };
    })
    .filter((c) => c !== undefined);
  return candidates
    .sort((a, b) => a.order - b.order)
    .slice(0, limit)
    .map((c) => c.item);
}

// ---- Sound drills ----

export const MAX_DRILLS_PER_CALL = 30;

export const drillWordSchema = z.object({
  korean: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[\p{Script=Hangul}\s]+$/u, "Hangul only"),
  meaning: z.string().trim().max(100).optional(),
});

export const newDrillSchema = z.object({
  contrast: z.string().trim().min(1).max(40),
  words: z
    .array(drillWordSchema)
    .min(2)
    .max(4)
    .refine((words) => new Set(words.map((w) => normalizeKorean(w.korean))).size === words.length, "words must differ"),
});

export type NewDrill = z.infer<typeof newDrillSchema>;

export type DrillDto = {
  id: number;
  contrast: string;
  words: { korean: string; meaning: string | null }[];
  correct: number;
  wrong: number;
  /** Every word has its reference audio, so the drill can be played. */
  ready: boolean;
  /** Other voices every word has too (voices.ts), besides the default one. */
  voices: ExtraVoice[];
};

const wordsKey = (words: { korean: string }[]) =>
  words
    .map((w) => normalizeKorean(w.korean))
    .sort()
    .join("|");

/** Stores new drills; a drill with the same set of words as an existing one is a duplicate. */
export function addDrills(db: Db, userId: number, inputs: NewDrill[], source: "app" | "claude", now = new Date()) {
  return db.transaction((tx) => {
    const created: { id: number; contrast: string; words: string[] }[] = [];
    const duplicates: { contrast: string; words: string[]; existingId: number }[] = [];
    for (const input of inputs) {
      const words = input.words.map((w) => ({ korean: normalizeKorean(w.korean), ...(w.meaning ? { meaning: w.meaning } : {}) }));
      const key = wordsKey(words);
      const existing = tx
        .select({ id: soundDrills.id })
        .from(soundDrills)
        .where(and(eq(soundDrills.userId, userId), eq(soundDrills.wordsKey, key)))
        .get();
      if (existing) {
        duplicates.push({ contrast: input.contrast, words: words.map((w) => w.korean), existingId: existing.id });
        continue;
      }
      const row = tx
        .insert(soundDrills)
        .values({ userId, contrast: input.contrast, words, wordsKey: key, source, createdAt: now })
        .returning({ id: soundDrills.id })
        .get();
      created.push({ id: row.id, contrast: input.contrast, words: words.map((w) => w.korean) });
    }
    return { created, duplicates };
  });
}

/** All drills, the ones answered worst first; unplayed ones count as half wrong. */
export function listDrills(db: Db, userId: number): DrillDto[] {
  const rows = db.select().from(soundDrills).where(eq(soundDrills.userId, userId)).all();
  const texts = [...new Set(rows.flatMap((r) => r.words.map((w) => w.korean)))];
  const voiced = new Set<string>();
  for (let i = 0; i < texts.length; i += 500) {
    const chunk = texts.slice(i, i + 500);
    for (const r of db.select({ text: speechAudio.text }).from(speechAudio).where(inArray(speechAudio.text, chunk)).all()) {
      voiced.add(r.text);
    }
  }
  const others = voicesFor(db, texts);
  const missRate = (r: { correct: number; wrong: number }) => (r.wrong + 1) / (r.correct + r.wrong + 2);
  return rows
    .sort((a, b) => missRate(b) - missRate(a) || a.correct + a.wrong - (b.correct + b.wrong) || a.id - b.id)
    .map((r) => ({
      id: r.id,
      contrast: r.contrast,
      words: r.words.map((w) => ({ korean: w.korean, meaning: w.meaning ?? null })),
      correct: r.correct,
      wrong: r.wrong,
      ready: r.words.every((w) => voiced.has(w.korean)),
      voices: EXTRA_VOICES.filter((v) => r.words.every((w) => others.get(w.korean)?.includes(v))),
    }));
}

export function recordDrillAnswer(db: Db, userId: number, id: number, correct: boolean, now = new Date()): boolean {
  const result = db
    .update(soundDrills)
    .set(
      correct
        ? { correct: sql`${soundDrills.correct} + 1`, lastPracticedAt: now }
        : { wrong: sql`${soundDrills.wrong} + 1`, lastPracticedAt: now },
    )
    .where(and(eq(soundDrills.id, id), eq(soundDrills.userId, userId)))
    .run();
  return result.changes > 0;
}

export function deleteDrill(db: Db, userId: number, id: number): boolean {
  return db.delete(soundDrills).where(and(eq(soundDrills.id, id), eq(soundDrills.userId, userId))).run().changes > 0;
}
