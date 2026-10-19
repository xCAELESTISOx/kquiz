import { normalizeKorean, isKoreanOnly } from "./korean";
import type { AddCardsResult, Card, CardSource, NewCard, RatingName, ReviewInput, ReviewMode, Stats } from "./types";

// Stand-in for apps/api while its endpoints are being built. Dev builds only (see api.ts).
// Scheduling here is a crude placeholder; the real one is ts-fsrs on the server.

interface MockState {
  cards: Card[];
  due: Record<string, string>; // `${cardId}:${mode}` → ISO date
  reps: Record<string, number>;
  reviewIds: string[];
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "kquiz.mock.v1";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const SEED: NewCard[] = [
  { korean: "안녕하세요", meaning: "здравствуйте", pronunciation: "안녕하세요", romanization: "annyeonghaseyo", exampleKo: "선생님, 안녕하세요!", exampleMeaning: "Здравствуйте, учитель!" },
  { korean: "감사합니다", meaning: "спасибо", pronunciation: "감사함니다", romanization: "gamsahamnida" },
  { korean: "물", meaning: "вода", romanization: "mul", exampleKo: "물 좀 주세요.", exampleMeaning: "Дайте, пожалуйста, воды." },
  { korean: "괜찮아요", meaning: "всё в порядке", pronunciation: "괜차나요", romanization: "gwaenchanayo" },
  { korean: "맛있다", meaning: "вкусный", pronunciation: "마싣따", romanization: "masitda" },
];

export class MockApi {
  private state: MockState;

  constructor(
    private storage: KeyValueStorage,
    private now: () => Date = () => new Date(),
  ) {
    const saved = storage.getItem(KEY);
    this.state = saved ? (JSON.parse(saved) as MockState) : { cards: [], due: {}, reps: {}, reviewIds: [] };
    if (!saved) this.insert(SEED, "app");
  }

  addCards(cards: NewCard[], source: CardSource): AddCardsResult {
    const result = this.insert(cards, source);
    this.save();
    return result;
  }

  queue(mode: ReviewMode, limit = 50): Card[] {
    const now = this.now().getTime();
    return this.state.cards
      .filter((c) => mode === "meaning" || c.speakable)
      .map((c) => ({ card: c, due: Date.parse(this.state.due[`${c.id}:${mode}`] ?? "") }))
      .filter((x) => x.due <= now)
      .sort((a, b) => a.due - b.due)
      .slice(0, limit)
      .map((x) => x.card);
  }

  review(input: ReviewInput): { ok: true; due: string } {
    const key = `${input.cardId}:${input.mode}`;
    if (!this.state.reviewIds.includes(input.id)) {
      const reps = input.rating === "again" ? 0 : (this.state.reps[key] ?? 0) + 1;
      this.state.reps[key] = reps;
      this.state.due[key] = new Date(this.now().getTime() + interval(input.rating, reps)).toISOString();
      this.state.reviewIds = [...this.state.reviewIds.slice(-499), input.id];
      this.save();
    }
    return { ok: true, due: this.state.due[key]! };
  }

  stats(): Stats {
    return {
      total: this.state.cards.length,
      due: { meaning: this.queue("meaning", Infinity).length, speech: this.queue("speech", Infinity).length },
    };
  }

  private insert(cards: NewCard[], source: CardSource): AddCardsResult {
    const result: AddCardsResult = { created: [], duplicates: [], rejected: [] };
    for (const input of cards) {
      const korean = normalizeKorean(input.korean);
      const meaning = input.meaning.trim();
      if (!korean || !meaning) {
        result.rejected.push({ input: input.korean, reason: "Нужны корейское слово и перевод" });
        continue;
      }
      const existing = this.state.cards.find((c) => c.korean === korean);
      if (existing) {
        result.duplicates.push({ korean, existingId: existing.id });
        continue;
      }
      const at = this.now().toISOString();
      const syllables = (korean.match(/[가-힣]/g) ?? []).length;
      const card: Card = {
        ...input,
        korean,
        meaning,
        id: crypto.randomUUID(),
        speakable: isKoreanOnly(korean) && syllables > 0 && syllables <= 12,
        source,
        createdAt: at,
        updatedAt: at,
      };
      this.state.cards.push(card);
      this.state.due[`${card.id}:meaning`] = at;
      this.state.due[`${card.id}:speech`] = at;
      result.created.push(card);
    }
    return result;
  }

  private save() {
    this.storage.setItem(KEY, JSON.stringify(this.state));
  }
}

function interval(rating: RatingName, reps: number): number {
  switch (rating) {
    case "again":
      return MINUTE;
    case "hard":
      return reps <= 1 ? 10 * MINUTE : DAY * reps;
    case "good":
      return DAY * 2 ** (reps - 1);
    case "easy":
      return DAY * 2 ** (reps + 1);
  }
}
