import { randomUUID } from "node:crypto";
import { isSpeakable, normalizeKorean, type NewCard } from "../cards.js";

export type CardSource = "app" | "claude" | "bulk";

export interface StoredCard extends NewCard {
  id: string;
  speakable: boolean;
  /** Waiting in the new-card queue, not yet in reviews. */
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
  newPerDay: number;
  streakDays: number;
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
  update(id: string, patch: CardPatch): Promise<StoredCard | null>;
  stats(now: Date): Promise<Stats>;
  weakSounds(limit: number): Promise<WeakSound[]>;
  hardCards(limit: number): Promise<HardCard[]>;
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
        queued: source === "claude",
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
    // Cards from the app are due right away in both modes (speech only when speakable); Claude's wait.
    const all = [...this.cards.values()];
    const live = all.filter((card) => !card.queued);
    return {
      cards: all.length,
      dueMeaning: live.length,
      dueSpeech: live.filter((card) => card.speakable).length,
      dueListening: 0,
      queued: all.length - live.length,
      newPerDay: 15,
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
