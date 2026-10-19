import { isKoreanOnly, normalizeKorean } from "./korean";
import type {
  AddCardResult,
  AddCardsResult,
  Card,
  CardSource,
  NewCard,
  QueueItem,
  RatingName,
  ReviewInput,
  ReviewMode,
  ReviewResult,
  ScoreResult,
  Stats,
} from "./types";

// Stand-in for apps/api when it isn't running. Dev builds only (see api.ts).
// Scheduling here is a crude placeholder; the real one is ts-fsrs on the server.

interface MockState {
  nextId: number;
  cards: Card[];
  due: Record<string, string>; // `${cardId}:${mode}` → ISO date
  reps: Record<string, number>;
  reviewIds: string[];
  reviewedToday: { day: string; count: number };
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "kquiz.mock.v2";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const SEED: NewCard[] = [
  { korean: "안녕하세요", meaning: "здравствуйте", pronunciation: "안녕하세요", romanization: "annyeonghaseyo", examples: [
      { ko: "선생님, 안녕하세요!", ru: "Здравствуйте, учитель!" },
      { ko: "여러분, 안녕하세요.", ru: "Здравствуйте, все." },
      { ko: "안녕하세요, 처음 뵙겠습니다.", ru: "Здравствуйте, приятно познакомиться." },
    ] },
  { korean: "감사합니다", meaning: "спасибо", pronunciation: "감사함니다", romanization: "gamsahamnida" },
  { korean: "물", meaning: "вода", romanization: "mul", examples: [{ ko: "물 좀 주세요.", ru: "Дайте, пожалуйста, воды." }] },
  { korean: "괜찮아요", meaning: "всё в порядке", pronunciation: "괜차나요", romanization: "gwaenchanayo" },
  { korean: "맛있다", meaning: "вкусный", pronunciation: "마싣따", romanization: "masitda" },
];

/** Same rule as the server: duplicates ignore spaces and punctuation. */
function dedupeKey(korean: string): string {
  return korean.normalize("NFC").replace(/[\s\p{P}]/gu, "");
}

export class MockApi {
  private state: MockState;

  constructor(
    private storage: KeyValueStorage,
    private now: () => Date = () => new Date(),
  ) {
    const saved = storage.getItem(KEY);
    this.state = saved
      ? (JSON.parse(saved) as MockState)
      : { nextId: 1, cards: [], due: {}, reps: {}, reviewIds: [], reviewedToday: { day: "", count: 0 } };
    if (!saved) for (const card of SEED) this.insert(card, "app");
  }

  addCard(input: NewCard): AddCardResult {
    const result = this.insert(input, "app");
    this.save();
    return result;
  }

  addCards(cards: NewCard[]): AddCardsResult {
    const result: AddCardsResult = { created: [], duplicates: [], rejected: [] };
    for (const input of cards) {
      if (!input.korean.trim() || !input.meaning.trim()) {
        result.rejected.push({ input: input.korean, reason: "korean and meaning are required" });
        continue;
      }
      const r = this.insert(input, "bulk");
      if (r.status === "created") result.created.push(r.card);
      else result.duplicates.push({ korean: normalizeKorean(input.korean), existingId: r.existingId });
    }
    this.save();
    return result;
  }

  queue(mode: ReviewMode, limit = 50): QueueItem[] {
    const now = this.now().getTime();
    return this.state.cards
      .filter((c) => mode === "meaning" || c.speakable)
      .map((card) => {
        const key = `${card.id}:${mode}`;
        const due = this.state.due[key]!;
        const reps = this.state.reps[key] ?? 0;
        return { card, mode, due, state: reps ? 2 : 0, reps, lapses: 0 };
      })
      .filter((item) => Date.parse(item.due) <= now)
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
      .slice(0, limit);
  }

  review(reviews: ReviewInput[]): { results: ReviewResult[] } {
    const results = [...reviews]
      .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))
      .map((input): ReviewResult => {
        const key = `${input.cardId}:${input.mode}`;
        if (this.state.reviewIds.includes(input.id)) return { id: input.id, status: "duplicate" };
        if (!this.state.cards.some((c) => c.id === input.cardId)) return { id: input.id, status: "card_not_found" };
        const reps = input.rating === "again" ? 0 : (this.state.reps[key] ?? 0) + 1;
        this.state.reps[key] = reps;
        this.state.due[key] = new Date(this.now().getTime() + interval(input.rating, reps)).toISOString();
        this.state.reviewIds = [...this.state.reviewIds.slice(-499), input.id];
        const day = this.now().toISOString().slice(0, 10);
        this.state.reviewedToday =
          this.state.reviewedToday.day === day ? { day, count: this.state.reviewedToday.count + 1 } : { day, count: 1 };
        return { id: input.id, status: "applied", due: this.state.due[key] };
      });
    this.save();
    return { results };
  }

  stats(): Stats {
    const day = this.now().toISOString().slice(0, 10);
    return {
      cards: this.state.cards.length,
      due: { meaning: this.queue("meaning", Infinity).length, speech: this.queue("speech", Infinity).length },
      reviewedToday: this.state.reviewedToday.day === day ? this.state.reviewedToday.count : 0,
    };
  }

  /**
   * Fake scoring, deterministic per word so the screen can be designed and screenshotted:
   * words of two or more syllables get one wrong syllable, longer ones also a weak one.
   */
  score(cardId: number): ScoreResult {
    const card = this.state.cards.find((c) => c.id === cardId);
    if (!card) throw new Error("card not found");
    const texts = card.korean.match(/[가-힣]/g) ?? [];
    const prons = (card.pronunciation ?? card.korean).match(/[가-힣]/g) ?? [];
    const sum = texts.reduce((n, ch) => n + ch.charCodeAt(0), 0);
    const wrong = texts.length >= 2 ? sum % texts.length : -1;
    const weak = texts.length >= 3 ? (wrong + 1) % texts.length : -1;
    const syllables = texts.map((text, i) => ({
      text,
      pron: prons.length === texts.length ? prons[i]! : text,
      status: i === wrong ? ("wrong" as const) : i === weak ? ("weak" as const) : ("ok" as const),
    }));
    const errors: ScoreResult["errors"] = [];
    if (wrong >= 0) {
      const onset = ONSETS[((syllables[wrong]!.pron.charCodeAt(0) - 0xac00) / 588) | 0]!;
      errors.push(
        onset[0] === "ㅇ"
          ? { syllable: wrong, position: "vowel", kind: "substitution", status: "wrong", expected: { ipa: "ʌ", jamo: "ㅓ" }, heard: { ipa: "o", jamo: "ㅗ" } }
          : {
              syllable: wrong,
              position: "onset",
              kind: "substitution",
              status: "wrong",
              expected: { ipa: onset[1], jamo: onset[0] },
              heard: onset[0] === "ㄷ" ? { ipa: "tʰ", jamo: "ㅌ" } : { ipa: "t", jamo: "ㄷ" },
            },
      );
    }
    if (weak >= 0) {
      errors.push({ syllable: weak, position: "vowel", kind: "unclear", status: "weak", expected: { ipa: "a", jamo: "ㅏ" }, heard: { ipa: "a", jamo: "ㅏ" } });
    }
    const score = Math.round((100 * syllables.reduce((n, s) => n + (s.status === "ok" ? 0.97 : s.status === "weak" ? 0.8 : 0.4), 0)) / Math.max(syllables.length, 1));
    const wrongCount = syllables.filter((s) => s.status === "wrong").length;
    return {
      attemptId: Date.now(),
      cardId,
      score,
      pronunciation: syllables.map((s) => s.pron).join(""),
      syllables,
      errors,
      suggestedRating: wrongCount === 0 ? "good" : wrongCount / syllables.length <= 0.5 ? "hard" : "again",
    };
  }

  private insert(input: NewCard, source: CardSource): AddCardResult {
    const korean = normalizeKorean(input.korean);
    const existing = this.state.cards.find((c) => dedupeKey(c.korean) === dedupeKey(korean));
    if (existing) return { status: "duplicate", existingId: existing.id };
    const at = this.now().toISOString();
    const syllables = (korean.match(/[가-힣]/g) ?? []).length;
    const readyForSpeech = isKoreanOnly(korean);
    const card: Card = {
      id: this.state.nextId++,
      korean,
      meaning: input.meaning.trim(),
      pronunciation: input.pronunciation ?? null,
      romanization: input.romanization ?? null,
      examples: input.examples ?? [],
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      speakable: readyForSpeech && syllables > 0 && syllables <= 12,
      readyForSpeech,
      source,
      createdAt: at,
      updatedAt: at,
    };
    this.state.cards.push(card);
    this.state.due[`${card.id}:meaning`] = at;
    this.state.due[`${card.id}:speech`] = at;
    return { status: "created", card };
  }

  private save() {
    this.storage.setItem(KEY, JSON.stringify(this.state));
  }
}

// Initial consonants in Unicode order, with their IPA, for the fake score.
const ONSETS: [string, string][] = [
  ["ㄱ", "k"], ["ㄲ", "k͈"], ["ㄴ", "n"], ["ㄷ", "t"], ["ㄸ", "t͈"], ["ㄹ", "ɾ"], ["ㅁ", "m"], ["ㅂ", "p"], ["ㅃ", "p͈"],
  ["ㅅ", "s"], ["ㅆ", "s͈"], ["ㅇ", ""], ["ㅈ", "tɕ"], ["ㅉ", "t͈ɕ"], ["ㅊ", "tɕʰ"], ["ㅋ", "kʰ"], ["ㅌ", "tʰ"], ["ㅍ", "pʰ"], ["ㅎ", "h"],
];

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
