import { randomUUID } from "node:crypto";
import { isSpeakable, normalizeKorean, type NewCard } from "../cards.js";

export type CardSource = "app" | "claude" | "bulk";

export interface StoredCard extends NewCard {
  id: string;
  speakable: boolean;
  source: CardSource;
  createdAt: string;
  updatedAt: string;
}

export type CardPatch = Partial<NewCard> & { speakable?: boolean };

export interface CardQuery {
  /** Matches korean, meaning, pronunciation or romanization, case-insensitive. */
  text?: string;
  tag?: string;
  limit: number;
}

export interface Stats {
  cards: number;
  dueMeaning: number;
  dueSpeech: number;
  /** Cards to recognise by ear; only those whose recording is made. */
  dueListening: number;
  streakDays: number;
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
  update(id: string, patch: CardPatch): Promise<StoredCard | null>;
  stats(now: Date): Promise<Stats>;
  weakSounds(limit: number): Promise<WeakSound[]>;
}

export class MemoryCardStore implements CardStore {
  readonly cards = new Map<string, StoredCard>();

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
        source,
        createdAt: now,
        updatedAt: now,
      };
      this.cards.set(stored.id, stored);
      return stored;
    });
  }

  async find({ text, tag, limit }: CardQuery): Promise<StoredCard[]> {
    const needle = text?.toLocaleLowerCase();
    const result: StoredCard[] = [];
    // Newest first, like the app's card list.
    for (const card of [...this.cards.values()].reverse()) {
      if (tag && !card.tags.includes(tag)) continue;
      if (needle) {
        const haystack = [card.korean, card.meaning, card.pronunciation, card.romanization];
        if (!haystack.some((field) => field?.toLocaleLowerCase().includes(needle))) continue;
      }
      result.push(card);
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

  async stats(): Promise<Stats> {
    // New cards are due right away in both modes; speech only for speakable ones.
    const all = [...this.cards.values()];
    return {
      cards: all.length,
      dueMeaning: all.length,
      dueSpeech: all.filter((card) => card.speakable).length,
      dueListening: 0,
      streakDays: 0,
    };
  }

  async weakSounds(): Promise<WeakSound[]> {
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
