// Shapes of the REST contract between the PWA and apps/api (camelCase, as in newCardSchema).

export type ReviewMode = "meaning" | "speech";
export type RatingName = "again" | "hard" | "good" | "easy";
export type CardSource = "app" | "claude" | "bulk";

export interface NewCard {
  korean: string;
  meaning: string;
  pronunciation?: string;
  romanization?: string;
  exampleKo?: string;
  exampleMeaning?: string;
  notes?: string;
  tags?: string[];
}

export interface Card extends NewCard {
  id: string;
  speakable: boolean;
  source: CardSource;
  createdAt: string;
  updatedAt: string;
}

export interface AddCardsResult {
  created: Card[];
  duplicates: { korean: string; existingId: string }[];
  rejected: { input: string; reason: string }[];
}

export interface ReviewInput {
  /** Client-generated UUID, so resending the same review is safe. */
  id: string;
  cardId: string;
  mode: ReviewMode;
  rating: RatingName;
  reviewedAt: string;
  elapsedMs: number;
}

export interface Stats {
  total: number;
  due: Record<ReviewMode, number>;
}
