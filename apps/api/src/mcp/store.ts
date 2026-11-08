import { randomUUID } from "node:crypto";
import { isSpeakable, normalizeKorean, type CardKind, type NewCard, type Root } from "../cards.js";

export type CardSource = "app" | "claude" | "bulk";

/** A word linked to a card as easy to mix up with it (apps/api/src/similar.ts). */
export interface SimilarLink {
  id: string;
  korean: string;
  meaning: string;
  note?: string;
}

/** Link (or unlink) two cards, each named by its Korean text. */
export interface SimilarPair {
  korean: string;
  other: string;
  note?: string;
  remove?: boolean;
}

export interface SimilarResult {
  linked: { korean: string; other: string }[];
  unlinked: { korean: string; other: string }[];
  rejected: { korean: string; other: string; reason: string }[];
}

export interface StoredCard extends NewCard {
  id: string;
  /** Left out when the card has none. */
  similar?: SimilarLink[];
  speakable: boolean;
  /** Waiting to be learned, not yet in reviews. */
  queued: boolean;
  source: CardSource;
  createdAt: string;
  updatedAt: string;
}

export type CardPatch = Partial<NewCard> & { speakable?: boolean };

export interface CardQuery {
  /** Matches korean, meaning, pronunciation or romanization, case-insensitive. */
  text?: string;
  tag?: string;
  /** A hanja: cards that have this root. */
  root?: string;
  /** Only cards whose roots were never filled in. */
  withoutRoots?: boolean;
  /** Only words, or only phrases. */
  kind?: CardKind;
  limit: number;
}

export interface Stats {
  cards: number;
  dueMeaning: number;
  dueSpeech: number;
  /** Cards to recognise by ear; only those whose recording is made. */
  dueListening: number;
  /** Cards from Claude still waiting to enter reviews, and how many enter per day. */
  queued: number;
  streakDays: number;
  /** Reviews coming due in the next 7 days (UTC), per mode, new cards left out. */
  dueNext7Days?: Record<string, number>;
  /** Share of reviews in the last 30 days not rated "again", per mode; null without data. */
  retention30d?: Record<string, number | null>;
}

/** A card forgotten again and again since its last edit (apps/api/src/leeches.ts). */
export interface HardCard {
  card: StoredCard;
  /** Days it was forgotten since the last edit, per review mode at the threshold. */
  forgotten: { meaning?: number; speech?: number; listening?: number };
  lastForgottenAt: string;
}

export interface WeakSound {
  phone: string;
  attempts: number;
  errors: number;
  errorRate: number;
}

/**
 * What the MCP tools need from card storage. The SQLite store in apps/api implements it;
 * MemoryCardStore stands in for tests and until that store lands.
 */
export interface CardStore {
  /** Cards whose normalized korean is already stored, keyed by that normalized text. */
  findByKorean(korean: string[]): Promise<Map<string, StoredCard>>;
  /** Inserts validated, deduplicated cards and creates their review states. */
  insert(cards: NewCard[], source: CardSource): Promise<StoredCard[]>;
  find(query: CardQuery): Promise<StoredCard[]>;
  get(id: string): Promise<StoredCard | null>;
  update(id: string, patch: CardPatch): Promise<StoredCard | null>;
  /** Sets roots only; unlike update it is not an edit, so a hard card stays on the hard list. */
  setRoots(items: { id: string; roots: Root[] }[]): Promise<{ saved: string[]; notFound: string[] }>;
  /** Links or unlinks pairs of the user's cards as similar words; not an edit of either card. */
  linkSimilar(pairs: SimilarPair[]): Promise<SimilarResult>;
  stats(now: Date): Promise<Stats>;
  weakSounds(limit: number): Promise<WeakSound[]>;
  hardCards(limit: number): Promise<HardCard[]>;
}

export class MemoryCardStore implements CardStore {
  readonly cards = new Map<string, StoredCard>();
  /** "idA|idB" (sorted) → note. */
  readonly links = new Map<string, string | undefined>();

  private withLinks(card: StoredCard): StoredCard {
    const similar: SimilarLink[] = [];
    for (const [key, note] of this.links) {
      const [a, b] = key.split("|");
      const otherId = a === card.id ? b : b === card.id ? a : undefined;
      const other = otherId && this.cards.get(otherId);
      if (other) similar.push({ id: other.id, korean: other.korean, meaning: other.meaning, ...(note ? { note } : {}) });
    }
    const { similar: _old, ...rest } = card;
    return similar.length ? { ...rest, similar } : rest;
  }

  async linkSimilar(pairs: SimilarPair[]): Promise<SimilarResult> {
    const result: SimilarResult = { linked: [], unlinked: [], rejected: [] };
    const byKorean = (text: string) => [...this.cards.values()].find((c) => c.korean === normalizeKorean(text));
    for (const pair of pairs) {
      const [a, b] = [byKorean(pair.korean), byKorean(pair.other)];
      const names = { korean: pair.korean, other: pair.other };
      if (!a || !b) result.rejected.push({ ...names, reason: `no card ${!a ? pair.korean : pair.other}` });
      else if (a === b) result.rejected.push({ ...names, reason: "same card" });
      else {
        const key = [a.id, b.id].sort().join("|");
        if (pair.remove) {
          if (this.links.delete(key)) result.unlinked.push(names);
        } else {
          this.links.set(key, pair.note ?? this.links.get(key));
          result.linked.push(names);
        }
      }
    }
    return result;
  }

  async findByKorean(korean: string[]): Promise<Map<string, StoredCard>> {
    const wanted = new Set(korean.map(normalizeKorean));
    const found = new Map<string, StoredCard>();
    for (const card of this.cards.values()) {
      const key = normalizeKorean(card.korean);
      if (wanted.has(key)) found.set(key, card);
    }
    return found;
  }

  async insert(cards: NewCard[], source: CardSource): Promise<StoredCard[]> {
    const now = new Date().toISOString();
    return cards.map((card) => {
      const korean = normalizeKorean(card.korean);
      const stored: StoredCard = {
        ...card,
        korean,
        id: randomUUID(),
        speakable: isSpeakable(korean),
        queued: true,
        source,
        createdAt: now,
        updatedAt: now,
      };
      this.cards.set(stored.id, stored);
      return stored;
    });
  }

  async get(id: string): Promise<StoredCard | null> {
    const card = this.cards.get(id);
    return card ? this.withLinks(card) : null;
  }

  async find({ text, tag, root, withoutRoots, kind, limit }: CardQuery): Promise<StoredCard[]> {
    const needle = text?.toLocaleLowerCase();
    const result: StoredCard[] = [];
    // Newest first, like the app's card list.
    for (const card of [...this.cards.values()].reverse()) {
      if (tag && !card.tags.includes(tag)) continue;
      if (root && !card.roots?.some((r) => r.hanja === root)) continue;
      if (withoutRoots && card.roots) continue;
      if (kind && (card.kind ?? "word") !== kind) continue;
      if (needle) {
        const haystack = [card.korean, card.meaning, card.pronunciation, card.romanization];
        if (!haystack.some((field) => field?.toLocaleLowerCase().includes(needle))) continue;
      }
      result.push(this.withLinks(card));
      if (result.length >= limit) break;
    }
    return result;
  }

  async update(id: string, patch: CardPatch): Promise<StoredCard | null> {
    const card = this.cards.get(id);
    if (!card) return null;
    const updated = { ...card, ...patch, updatedAt: new Date().toISOString() };
    if (patch.korean !== undefined) {
      updated.korean = normalizeKorean(patch.korean);
      if (patch.speakable === undefined) updated.speakable = isSpeakable(updated.korean);
    }
    this.cards.set(id, updated);
    return updated;
  }

  async setRoots(items: { id: string; roots: Root[] }[]) {
    const saved: string[] = [];
    const notFound: string[] = [];
    for (const { id, roots } of items) {
      const card = this.cards.get(id);
      if (!card) notFound.push(id);
      else {
        card.roots = roots;
        saved.push(id);
      }
    }
    return { saved, notFound };
  }

  async stats(): Promise<Stats> {
    // Cards from the app are due right away in both modes (speech only when speakable); Claude's wait.
    const all = [...this.cards.values()];
    const live = all.filter((card) => !card.queued);
    return {
      cards: all.length,
      dueMeaning: live.length,
      dueSpeech: live.filter((card) => card.speakable).length,
      dueListening: 0,
      queued: all.length - live.length,
      streakDays: 0,
    };
  }

  async weakSounds(): Promise<WeakSound[]> {
    return [];
  }

  async hardCards(): Promise<HardCard[]> {
    return [];
  }
}

export interface DrillWord {
  korean: string;
  meaning?: string;
}

export interface NewDrill {
  contrast: string;
  words: DrillWord[];
}

export interface StoredDrill extends NewDrill {
  id: number;
  correct: number;
  wrong: number;
}

/** Listening drills on similar sounds (apps/api/src/practice.ts). Claude can add and list them, not delete. */
export interface DrillStore {
  add(drills: NewDrill[]): Promise<{ created: { id: number; contrast: string; words: string[] }[]; duplicates: { contrast: string; words: string[]; existingId: number }[] }>;
  list(): Promise<StoredDrill[]>;
}

export class MemoryDrillStore implements DrillStore {
  readonly drills: StoredDrill[] = [];

  async add(drills: NewDrill[]) {
    const created: { id: number; contrast: string; words: string[] }[] = [];
    const duplicates: { contrast: string; words: string[]; existingId: number }[] = [];
    const key = (d: NewDrill) => d.words.map((w) => normalizeKorean(w.korean)).sort().join("|");
    for (const drill of drills) {
      const words = drill.words.map((w) => normalizeKorean(w.korean));
      const existing = this.drills.find((d) => key(d) === key(drill));
      if (existing) {
        duplicates.push({ contrast: drill.contrast, words, existingId: existing.id });
        continue;
      }
      const stored = { ...drill, id: this.drills.length + 1, correct: 0, wrong: 0 };
      this.drills.push(stored);
      created.push({ id: stored.id, contrast: drill.contrast, words });
    }
    return { created, duplicates };
  }

  async list() {
    return this.drills;
  }
}
