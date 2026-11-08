import { State } from "ts-fsrs";
import { and, count, desc, eq, isNull, lt, sql, type SQL } from "drizzle-orm";
import { isKoreanOnly, isSpeakable, koreanKey, normalizeKorean, type CardKind, type CardPatch, type Example, type NewCard, type PhrasePart, type Register, type Root } from "./cards.js";
import type { Db } from "./db/client.js";
import { cards, reviewStates } from "./db/schema.js";
import { withSimilar, type SimilarWord } from "./similar.js";
import { cardsLeft, QuotaError } from "./users.js";

export type CardSource = "app" | "claude" | "bulk";
type CardRow = typeof cards.$inferSelect;

export type CardDto = {
  id: number;
  korean: string;
  meaning: string;
  pronunciation: string | null;
  romanization: string | null;
  examples: Example[];
  notes: string | null;
  tags: string[];
  /** Sino-Korean roots; null until someone (usually Claude) fills them in, [] for a native word. */
  roots: Root[] | null;
  /** A word, or a set phrase learned whole. */
  kind: CardKind;
  /** A phrase's pieces in order; null for a word or a phrase not broken down yet. */
  parts: PhrasePart[] | null;
  register: Register | null;
  speakable: boolean;
  /** False when `korean` has non-Hangul text: the card can't enter the pronunciation queue. */
  readyForSpeech: boolean;
  source: CardSource;
  /** Paused: out of every review queue, schedule kept. */
  suspended: boolean;
  /** Waiting in the new-card queue, not yet in reviews. */
  queued: boolean;
  /** Words easy to mix up with this one (similar.ts); filled in by withSimilar, [] until then. */
  similar: SimilarWord[];
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
    examples: row.examples,
    notes: row.notes,
    tags: row.tags,
    roots: row.roots,
    kind: row.kind,
    parts: row.parts,
    register: row.register,
    speakable: row.speakable,
    readyForSpeech: isKoreanOnly(row.korean),
    source: row.source,
    suspended: row.suspended,
    queued: row.introducedAt === null,
    similar: [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type Duplicate = { korean: string; existingId: number };
export type CreateResult = { created: CardDto[]; duplicates: Duplicate[] };

const emptyToNull = (value: string | undefined) => (value ? value : null);

/** Pronunciation is kept bare (익따, not [익따]: the app adds the brackets), and only when it differs from the spelling. */
export function cleanPronunciation(value: string | null | undefined, korean: string): string | null {
  const bare = value?.replace(/^[\s\[]+|[\s\]]+$/g, "") ?? "";
  return bare && bare !== korean ? bare : null;
}
const uniqueTags = (tags: string[]) => [...new Set(tags)];

/**
 * Stores new cards. Cards added in the app get a fresh schedule in every mode at once; cards from
 * Claude wait in the new-card queue (newCards.ts). A card whose Korean already exists (or repeats
 * earlier in the batch) is reported as a duplicate, not stored. Duplicates are per user: two people
 * can both have 사랑. Past a member's card limit (users.ts) nothing is stored and QuotaError is thrown.
 */
export function createCards(db: Db, userId: number, inputs: NewCard[], source: CardSource, now = new Date()): CreateResult {
  return db.transaction((tx) => {
    const created: CardDto[] = [];
    const duplicates: Duplicate[] = [];
    const left = cardsLeft(tx, userId, now);
    for (const input of inputs) {
      const korean = normalizeKorean(input.korean);
      const key = koreanKey(korean);
      const existing = tx.select({ id: cards.id }).from(cards).where(and(eq(cards.userId, userId), eq(cards.koreanKey, key))).get();
      if (existing) {
        duplicates.push({ korean, existingId: existing.id });
        continue;
      }
      // Throwing rolls the whole batch back.
      if (created.length >= left) throw new QuotaError("cards", left);
      const row = tx
        .insert(cards)
        .values({
          userId,
          korean,
          koreanKey: key,
          meaning: input.meaning,
          pronunciation: cleanPronunciation(input.pronunciation, korean),
          romanization: emptyToNull(input.romanization),
          examples: input.examples ?? [],
          notes: emptyToNull(input.notes),
          tags: uniqueTags(input.tags),
          roots: input.roots ?? null,
          kind: input.kind ?? "word",
          parts: input.parts?.length ? input.parts : null,
          register: input.register ?? null,
          speakable: (input.speakable ?? isSpeakable(korean)) && isKoreanOnly(korean),
          source,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      // Every new word waits to be learned first (newCards.ts), wherever it was added.
      created.push(toCardDto(row));
    }
    return { created, duplicates };
  });
}

export function getCard(db: Db, userId: number, id: number): CardDto | undefined {
  const row = db.select().from(cards).where(and(eq(cards.id, id), eq(cards.userId, userId))).get();
  return row && withSimilar(db, userId, [toCardDto(row)])[0];
}

export type CardQuery = {
  /** Substring of the Korean text or the meaning. */
  q?: string;
  tag?: string;
  /** Hanja of a root: the word family of that root. */
  root?: string;
  /** Only cards whose roots nobody has filled in yet. */
  rootsUnset?: boolean;
  /** Only cards with non-Hangul `korean`, the "not ready for checking" filter. */
  notReady?: boolean;
  /** Only queued cards (not yet in reviews), or only paused ones. */
  status?: "queued" | "paused";
  /** Only words, or only phrases. */
  kind?: CardKind;
  limit?: number;
  /** Id of the last card on the previous page; pages go from newest to oldest. */
  before?: number;
};

/** The SQL side of a card filter; `notReady` is left to the caller (see listCards). */
export function cardConditions(userId: number, query: Omit<CardQuery, "limit" | "before" | "notReady">): SQL[] {
  const where: SQL[] = [eq(cards.userId, userId)];
  if (query.q) {
    const pattern = `%${query.q.toLocaleLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where.push(sql`(ulower(${cards.korean}) like ${pattern} escape '\\' or ulower(${cards.meaning}) like ${pattern} escape '\\')`);
  }
  if (query.tag) where.push(sql`exists (select 1 from json_each(${cards.tags}) where value = ${query.tag})`);
  if (query.root) where.push(sql`exists (select 1 from json_each(${cards.roots}) where json_extract(value, '$.hanja') = ${query.root})`);
  if (query.rootsUnset) where.push(isNull(cards.roots));
  if (query.status === "queued") where.push(isNull(cards.introducedAt));
  if (query.status === "paused") where.push(eq(cards.suspended, true));
  if (query.kind) where.push(eq(cards.kind, query.kind));
  return where;
}

export function listCards(db: Db, userId: number, query: CardQuery = {}): { cards: CardDto[]; nextBefore: number | null } {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const where = cardConditions(userId, query);
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
  return { cards: withSimilar(db, userId, page.map(toCardDto)), nextBefore: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
}

/** Every tag in use, most used first. */
export function listTags(db: Db, userId: number): { tag: string; count: number }[] {
  return db
    .select({ tag: sql<string>`j.value`, count: count() })
    .from(sql`${cards}, json_each(${cards.tags}) as j`)
    .where(eq(cards.userId, userId))
    .groupBy(sql`j.value`)
    .orderBy(desc(count()), sql`j.value`)
    .all();
}

/** Cards in the new-card queue and paused cards, for the filter chips. */
export function cardCounts(db: Db, userId: number): { all: number; queued: number; paused: number; phrases: number } {
  const row = db
    .select({
      all: count(),
      phrases: sql<number>`coalesce(sum(${cards.kind} = 'phrase'), 0)`,
      queued: sql<number>`coalesce(sum(${cards.introducedAt} is null), 0)`,
      paused: sql<number>`coalesce(sum(${cards.suspended}), 0)`,
    })
    .from(cards)
    .where(eq(cards.userId, userId))
    .get();
  return { all: row?.all ?? 0, queued: row?.queued ?? 0, paused: row?.paused ?? 0, phrases: row?.phrases ?? 0 };
}

/**
 * `known`: well learned for meaning (past the learning steps, remembered for a week or more), so a
 * word the user can lean on to guess a new one.
 */
const KNOWN_STABILITY_DAYS = 7;

export type FamilyMember = { id: number; korean: string; meaning: string; known: boolean };
export type Family = Root & { cards: FamilyMember[]; total: number };

/**
 * For each root of a card, the user's other cards with the same hanja (known ones first,
 * then newest, at most `perRoot`), and how many there are in all. Paused and queued cards count too:
 * they are still words the user has.
 */
export function cardFamily(db: Db, userId: number, id: number, perRoot = 5): Family[] | undefined {
  const card = db.select({ roots: cards.roots }).from(cards).where(and(eq(cards.id, id), eq(cards.userId, userId))).get();
  if (!card) return undefined;
  const seen = new Set<string>();
  const families: Family[] = [];
  for (const root of card.roots ?? []) {
    if (seen.has(root.hanja)) continue;
    seen.add(root.hanja);
    const where = and(...cardConditions(userId, { root: root.hanja }), sql`${cards.id} <> ${id}`);
    const total = db.select({ n: count() }).from(cards).where(where).get()?.n ?? 0;
    const known = sql<number>`exists (select 1 from ${reviewStates} where ${reviewStates.cardId} = ${cards.id} and ${reviewStates.mode} = 'meaning' and ${reviewStates.state} = ${State.Review} and ${reviewStates.stability} >= ${KNOWN_STABILITY_DAYS})`;
    const members = db
      .select({ id: cards.id, korean: cards.korean, meaning: cards.meaning, known })
      .from(cards)
      .where(where)
      .orderBy(desc(known), desc(cards.id))
      .limit(perRoot)
      .all();
    families.push({ ...root, cards: members.map((m) => ({ ...m, known: !!m.known })), total });
  }
  return families;
}

export type UpdateResult = { card: CardDto } | { error: "not_found" } | { error: "duplicate"; existingId: number };

/** `suspended` comes only from the app: Claude can't pause cards. */
export function updateCard(
  db: Db,
  userId: number,
  id: number,
  patch: CardPatch & { suspended?: boolean },
  now = new Date(),
): UpdateResult {
  return db.transaction((tx) => {
    const current = tx.select().from(cards).where(and(eq(cards.id, id), eq(cards.userId, userId))).get();
    if (!current) return { error: "not_found" };
    const korean = patch.korean === undefined ? current.korean : normalizeKorean(patch.korean);
    const key = koreanKey(korean);
    if (key !== current.koreanKey) {
      const other = tx.select({ id: cards.id }).from(cards).where(and(eq(cards.userId, userId), eq(cards.koreanKey, key))).get();
      if (other) return { error: "duplicate", existingId: other.id };
    }
    const optional = (value: string | undefined, old: string | null) => (value === undefined ? old : emptyToNull(value));
    const row = tx
      .update(cards)
      .set({
        korean,
        koreanKey: key,
        meaning: patch.meaning ?? current.meaning,
        pronunciation: cleanPronunciation(optional(patch.pronunciation, current.pronunciation), korean),
        romanization: optional(patch.romanization, current.romanization),
        examples: patch.examples ?? current.examples,
        notes: optional(patch.notes, current.notes),
        tags: patch.tags ? uniqueTags(patch.tags) : current.tags,
        roots: patch.roots ?? current.roots,
        kind: patch.kind ?? current.kind,
        parts: patch.parts ? (patch.parts.length ? patch.parts : null) : current.parts,
        register: patch.register ?? current.register,
        suspended: patch.suspended ?? current.suspended,
        speakable: (patch.speakable ?? (patch.korean === undefined ? current.speakable : isSpeakable(korean))) && isKoreanOnly(korean),
        updatedAt: now,
      })
      .where(eq(cards.id, id))
      .returning()
      .get();
    return { card: withSimilar(tx as unknown as Db, userId, [toCardDto(row)])[0]! };
  });
}

export function deleteCard(db: Db, userId: number, id: number): boolean {
  return db.delete(cards).where(and(eq(cards.id, id), eq(cards.userId, userId))).run().changes > 0;
}
