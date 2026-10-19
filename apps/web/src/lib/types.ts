// Shapes of the REST contract with apps/api (see apps/api/README.md).

export type ReviewMode = "meaning" | "speech";
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

export interface AddCardsResult {
  created: Card[];
  duplicates: { korean: string; existingId: number }[];
  rejected: { input: string; reason: string }[];
}

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
}

export interface AuthStatus {
  authenticated: boolean;
  setupRequired: boolean;
  csrfToken?: string;
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
