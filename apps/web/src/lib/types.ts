// Shapes of the REST contract with apps/api (see apps/api/README.md).

/** Meaning: Hangul → translation. Speech: say it aloud. Listening: hear it with no text → translation. */
export type ReviewMode = "meaning" | "speech" | "listening";
export type RatingName = "again" | "hard" | "good" | "easy";
export type CardSource = "app" | "claude" | "bulk";

/** A Korean sentence that uses the word, with its Russian translation. */
export interface Example {
  ko: string;
  ru: string;
}

export interface NewCard {
  korean: string;
  meaning: string;
  pronunciation?: string;
  romanization?: string;
  examples?: Example[];
  notes?: string;
  tags?: string[];
}

export interface Card {
  id: number;
  korean: string;
  meaning: string;
  pronunciation: string | null;
  romanization: string | null;
  examples: Example[];
  notes: string | null;
  tags: string[];
  speakable: boolean;
  /** False when `korean` has non-Hangul text; such cards never become speakable. */
  readyForSpeech: boolean;
  source: CardSource;
  /** Paused: in no review queue, schedule kept. */
  suspended: boolean;
  /** Waiting in the new-card queue (cards from Claude), not yet in reviews. */
  queued: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QueueItem {
  card: Card;
  mode: ReviewMode;
  due: string;
  state: number;
  reps: number;
  lapses: number;
}

/** A card forgotten on many different days since its last edit (GET /api/reviews/leeches). */
export interface Leech {
  card: Card;
  forgotten: Partial<Record<ReviewMode, number>>;
  lastForgottenAt: string;
}

export interface AddCardsResult {
  created: Card[];
  duplicates: { korean: string; existingId: number }[];
  rejected: { input: string; reason: string }[];
}

export type UpdateCardResult = { status: "saved"; card: Card } | { status: "duplicate"; existingId: number };

export type AddCardResult = { status: "created"; card: Card } | { status: "duplicate"; existingId: number };

export interface ReviewInput {
  /** Client-generated UUID, so resending the same review is safe. */
  id: string;
  cardId: number;
  mode: ReviewMode;
  rating: RatingName;
  reviewedAt: string;
  elapsedMs?: number;
}

export interface ReviewResult {
  id: string;
  status: "applied" | "duplicate" | "card_not_found";
  due?: string;
}

export interface Stats {
  cards: number;
  due: Record<ReviewMode, number>;
  reviewedToday: number;
  /** New cards let in from the queue today, the daily allowance and what still waits. */
  newCards: { introduced: number; limit: number; queued: number };
}

/** PATCH /api/cards/:id: any field; "" clears an optional one. */
export type CardPatch = Partial<Omit<NewCard, "tags">> & { tags?: string[]; speakable?: boolean; suspended?: boolean };

export type CardFilter = "queued" | "paused";

/** A group of cards picked on the cards screen to review on its own: a search, a tag, the queue. */
export interface GroupFilter {
  q?: string;
  tag?: string;
  status?: "queued";
}

export interface CardList {
  cards: Card[];
  nextBefore: number | null;
}

export interface CardSummary {
  counts: { all: number; queued: number; paused: number };
  tags: { tag: string; count: number }[];
}

export interface Settings {
  newPerDay: number;
}

/** GET /api/stats. Modes are keys, so a mode added later shows up without a contract change. */
export interface StatsOverview {
  today: string;
  streak: { current: number; best: number; reviewedToday: boolean };
  activity: { day: string; reviews: number }[];
  forecast: { day: string; due: Record<string, number> }[];
  retention: Record<string, { reviews: number; recalled: number }>;
  targetRetention: Record<string, number>;
  cards: { total: number; byMode: Record<string, { new: number; learning: number; young: number; mature: number }> };
  speech: {
    weeks: { start: string; attempts: number; avgScore: number | null }[];
    sounds: {
      phone: string;
      attempts: number;
      errors: number;
      recent: { attempts: number; errors: number };
      previous: { attempts: number; errors: number };
    }[];
  };
}

export interface FsrsModeStatus {
  mode: ReviewMode;
  desiredRetention: number;
  /** True once intervals use parameters fitted to the owner's own reviews. */
  personal: boolean;
  reviews: number;
  minReviews: number;
  trainedOnReviews: number | null;
  optimizedAt: string | null;
}

export interface FsrsStatus {
  modes: FsrsModeStatus[];
  retentionRange: { min: number; max: number };
}

export interface AuthStatus {
  authenticated: boolean;
  setupRequired: boolean;
  csrfToken?: string;
  user?: { id: number; name: string; role: "owner" | "member" };
}

/** Whether an invite link still works: "full" when the server already has as many people as it allows. */
export type InviteStatus = "ok" | "invalid" | "full";

export interface AccessUser {
  id: number;
  name: string;
  role: "owner" | "member";
  createdAt: string;
  disabled: boolean;
  cards: number;
  lastSignInAt: string | null;
}

export interface AccessInfo {
  users: AccessUser[];
  invites: { createdAt: string; expiresAt: string }[];
  maxUsers: number;
  memberLimits: { cardsPerDay: number; cards: number; scoresPerDay: number };
}

export type SyllableStatus = "ok" | "weak" | "wrong";

export interface Sound {
  ipa: string;
  jamo: string;
}

/** POST /api/score, fields as services/scorer returns them. */
export interface ScoreResult {
  attemptId: number;
  cardId: number;
  score: number;
  /** How the word is actually said, in Hangul (국물 → 궁물). */
  pronunciation: string;
  /** Hangul syllables of the card, in order; spaces and punctuation are not included. */
  syllables: { text: string; pron: string; status: SyllableStatus }[];
  errors: {
    syllable: number;
    position: "onset" | "vowel" | "coda" | "extra";
    kind: "substitution" | "deletion" | "insertion" | "unclear";
    status: Exclude<SyllableStatus, "ok">;
    expected?: Sound | null;
    heard?: Sound | null;
  }[];
  suggestedRating: RatingName;
}
