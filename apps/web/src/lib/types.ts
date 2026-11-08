// Shapes of the REST contract with apps/api (see apps/api/README.md).

/** Meaning: Hangul → translation. Speech: say it aloud. Listening: hear it with no text → translation. */
export type ReviewMode = "meaning" | "speech" | "listening";
/** A queue of one mode, or every mode mixed in one session (each item keeps its own mode). */
export type QueueMode = ReviewMode | "mixed";
/** What a mixed session may hold: the speech schedule is gone through aloud, by picking from options, or both. */
/** What a mixed session can ask: typing by translation goes to the speech schedule, by ear to listening. */
export type MixKind = "meaning" | "aloud" | "choice" | "write" | "listening" | "dictation";
export type RatingName = "again" | "hard" | "good" | "easy";
export type CardSource = "app" | "claude" | "bulk";

/** A Korean sentence that uses the word, with its Russian translation. */
export interface Example {
  ko: string;
  ru: string;
}

/** A Sino-Korean root: the syllable, its hanja and a short gloss, e.g. 학 學 "study". */
export interface Root {
  ko: string;
  hanja: string;
  meaning: string;
}

/** One root of a card and the user's other cards that share it (GET /api/cards/:id/family). */
export interface Family extends Root {
  /** `known`: well learned for meaning, a word to guess new ones from. */
  cards: { id: number; korean: string; meaning: string; known: boolean }[];
  /** All cards with this root besides this one; `cards` holds the newest few. */
  total: number;
}

/** Another of the user's cards easy to mix up with this one, and how the two differ. */
export interface SimilarWord {
  id: number;
  korean: string;
  meaning: string;
  note: string | null;
}

/** A word, or a set phrase learned whole (안녕히 가세요). */
export type CardKind = "word" | "phrase";

/** 합쇼체 (formal), 해요체 (polite), 반말 (casual). */
export type Register = "formal" | "polite" | "casual";

/** A piece of a phrase as written in it, its dictionary form when different, and the user's card for that word. */
export interface PhrasePart {
  ko: string;
  base?: string;
  meaning: string;
  /** Only on a single card (GET /api/cards/:id). */
  cardId?: number;
}

/** The blocks a phrase is built from, in order, and the wrong ones mixed in (GET /api/reviews/blocks). */
export interface PhraseTiles {
  blocks: string[];
  decoys: string[];
}

export interface NewCard {
  korean: string;
  meaning: string;
  pronunciation?: string;
  romanization?: string;
  examples?: Example[];
  notes?: string;
  tags?: string[];
  roots?: Root[];
  kind?: CardKind;
  parts?: PhrasePart[];
  register?: Register;
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
  /** Null until Claude fills them in; [] for a native word. */
  roots: Root[] | null;
  kind: CardKind;
  /** A phrase's pieces in order; null for a word. */
  parts: PhrasePart[] | null;
  register: Register | null;
  speakable: boolean;
  /** False when `korean` has non-Hangul text; such cards never become speakable. */
  readyForSpeech: boolean;
  source: CardSource;
  /** Paused: in no review queue, schedule kept. */
  suspended: boolean;
  /** Waiting in the new-card queue (cards from Claude), not yet in reviews. */
  queued: boolean;
  /** Words easy to mix up with this one (휴지통 / 쓰레기통), linked both ways. */
  similar?: SimilarWord[];
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
  /** Listening only: other voices the word can be heard in besides the default one (lib/voices.ts). */
  voices?: string[];
  /** In a session only: a step of learning a new word, not a review (lib/session.ts). */
  learn?: { kind: "intro" | "choose" | "build" | "aloud" | "dictation" | "write"; check?: boolean };
}

/** A wrong option on the "pick the Korean word" screen: another of the user's words. */
export interface ChoiceOption {
  id: number;
  korean: string;
  meaning: string;
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

/** A new word being learned: its ladder step (0–2), or "check" once it has waited (apps/api newCards.ts). */
export interface LearningItem {
  card: Card;
  step: number | "check";
}

export type LearningAnswer =
  | { status: "climbed" | "missed"; step: number }
  | { status: "passed"; next: LearningItem | null }
  | { status: "learned"; due: string };

export interface ReviewResult {
  id: string;
  status: "applied" | "duplicate" | "card_not_found";
  due?: string;
}

export interface Stats {
  cards: number;
  /** Tasks due per mode: a word due for meaning and by ear counts twice. */
  due: Record<ReviewMode, number>;
  /** Words due in any mode, each once. */
  dueWords: number;
  /** Reviews answered today (learned words only; learning new ones isn't counted). */
  reviewedToday: number;
  /** Words past the new-word pool and not paused, and of them the ones learned today. */
  learned: number;
  learnedToday: number;
  /**
   * New words not learned yet: all of them (`queued`), the ones already being learned, and the
   * Korean of the next few "Learn" comes to.
   */
  /**
   * New words not learned yet (apps/api newCards.ts): `learning` started and unfinished, of them
   * `started` on the ladder or due for their check, `fresh` the new ones the next session takes,
   * `pool` not started; `next` the Korean of what "Learn" comes to.
   */
  newCards: { queued: number; learning: number; next: string[]; started: number; fresh: number; pool: number };
}

/** PATCH /api/cards/:id: any field; "" clears an optional one. */
export type CardPatch = Partial<Omit<NewCard, "tags">> & { tags?: string[]; speakable?: boolean; suspended?: boolean };

/** A filter of the cards screen: the new-card queue, paused cards, or phrases only. */
export type CardFilter = "queued" | "paused" | "phrases";

/** A group of cards picked on the cards screen to review on its own: a search, a tag, the queue. */
export interface GroupFilter {
  q?: string;
  tag?: string;
  /** A hanja: the word family of that root. */
  root?: string;
  status?: "queued";
  /** Only phrases. */
  kind?: "phrase";
}

export interface CardList {
  cards: Card[];
  nextBefore: number | null;
}

export interface CardSummary {
  counts: { all: number; queued: number; paused: number; phrases: number };
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
  /** words: distinct words due that day (a word due in two modes counts once). */
  forecast: { day: string; due: Record<string, number>; words?: number }[];
  /** Words past the new-word pool ("Learn") and not paused. */
  learned?: number;
  /** New words taken into "Learn" and not learned yet: not in the forecast until they are. */
  learning?: number;
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
  /** Null for a practice take, which is not kept. */
  attemptId: number | null;
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
