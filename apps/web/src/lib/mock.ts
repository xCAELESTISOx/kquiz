import { isKoreanOnly, normalizeKorean } from "./korean";
import type {
  AddCardResult,
  AddCardsResult,
  Card,
  CardFilter,
  CardList,
  CardPatch,
  CardSource,
  CardSummary,
  ChoiceOption,
  Family,
  FsrsStatus,
  GroupFilter,
  NewCard,
  QueueItem,
  QueueMode,
  RatingName,
  ReviewInput,
  ReviewMode,
  ReviewResult,
  ScoreResult,
  Settings,
  Stats,
  StatsOverview,
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
  newPerDay: number;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "kquiz.mock.v4";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function root(ko: string, hanja: string, meaning: string) {
  return { ko, hanja, meaning };
}

const SEED: NewCard[] = [
  { korean: "안녕하세요", meaning: "здравствуйте", pronunciation: "안녕하세요", romanization: "annyeonghaseyo", examples: [
      { ko: "선생님, 안녕하세요!", ru: "Здравствуйте, учитель!" },
      { ko: "여러분, 안녕하세요.", ru: "Здравствуйте, все." },
      { ko: "안녕하세요, 처음 뵙겠습니다.", ru: "Здравствуйте, приятно познакомиться." },
    ] },
  { korean: "감사합니다", meaning: "спасибо", pronunciation: "감사함니다", romanization: "gamsahamnida" },
  { korean: "물", meaning: "вода", romanization: "mul", examples: [{ ko: "물 좀 주세요.", ru: "Дайте, пожалуйста, воды." }] },
  { korean: "괜찮아요", meaning: "всё в порядке", pronunciation: "괜차나요", romanization: "gwaenchanayo" },
  { korean: "맛있다", meaning: "вкусный", pronunciation: "마싣따", romanization: "masitda", tags: ["еда"], roots: [] },
  { korean: "학교", meaning: "школа", pronunciation: "학꾜", tags: ["учёба"], roots: [root("학", "學", "учёба"), root("교", "校", "школа")], examples: [
      { ko: "학교에 가요.", ru: "Иду в школу." },
      { ko: "우리 학교는 커요.", ru: "Наша школа большая." },
      { ko: "학교 앞에서 만나요.", ru: "Встретимся перед школой." },
    ] },
  { korean: "학생", meaning: "студент, ученик", pronunciation: "학쌩", tags: ["учёба"], roots: [root("학", "學", "учёба"), root("생", "生", "жизнь, рождение")] },
  { korean: "대학교", meaning: "университет", pronunciation: "대학꾜", tags: ["учёба"], roots: [root("대", "大", "большой"), root("학", "學", "учёба"), root("교", "校", "школа")] },
  { korean: "선생님", meaning: "учитель", tags: ["учёба"], roots: [root("선", "先", "прежде"), root("생", "生", "жизнь, рождение")] },
];

// As if Claude had just added them: they wait in the new-card queue.
const SEED_QUEUED: NewCard[] = [
  { korean: "지하철", meaning: "метро", tags: ["город"], roots: [root("지", "地", "земля"), root("하", "下", "низ"), root("철", "鐵", "железо")] },
  { korean: "편의점", meaning: "круглосуточный магазин", pronunciation: "펴니점", tags: ["город"] },
  { korean: "영수증", meaning: "чек", tags: ["покупки"] },
  { korean: "계산하다", meaning: "расплачиваться, считать", tags: ["покупки", "глаголы"] },
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
      : { nextId: 1, cards: [], due: {}, reps: {}, reviewIds: [], reviewedToday: { day: "", count: 0 }, newPerDay: 15 };
    if (!saved) {
      for (const card of SEED) this.insert(card, "app");
      for (const card of SEED_QUEUED) this.insert(card, "claude");
    }
  }

  cards(query: { q?: string; tag?: string; root?: string; status?: CardFilter; before?: number; limit?: number }): CardList {
    const limit = query.limit ?? 50;
    const q = query.q?.toLocaleLowerCase();
    const found = [...this.state.cards]
      .reverse()
      .filter(
        (c) =>
          (!q || c.korean.toLocaleLowerCase().includes(q) || c.meaning.toLocaleLowerCase().includes(q)) &&
          (!query.tag || c.tags.includes(query.tag)) &&
          (!query.root || !!c.roots?.some((r) => r.hanja === query.root)) &&
          (query.status !== "queued" || c.queued) &&
          (query.status !== "paused" || c.suspended) &&
          (!query.before || c.id < query.before),
      );
    const page = found.slice(0, limit);
    return { cards: page, nextBefore: found.length > limit ? page.at(-1)!.id : null };
  }

  cardSummary(): CardSummary {
    const tags = new Map<string, number>();
    for (const card of this.state.cards) for (const tag of card.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    return {
      counts: {
        all: this.state.cards.length,
        queued: this.state.cards.filter((c) => c.queued).length,
        paused: this.state.cards.filter((c) => c.suspended).length,
      },
      tags: [...tags].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    };
  }

  family(id: number): Family[] {
    const card = this.card(id);
    const seen = new Set<string>();
    return (card.roots ?? []).flatMap((root) => {
      if (seen.has(root.hanja)) return [];
      seen.add(root.hanja);
      const others = this.cards({ root: root.hanja, limit: Infinity }).cards.filter((c) => c.id !== id);
      return [{ ...root, cards: others
            .map(({ id, korean, meaning }) => ({ id, korean, meaning, known: (this.state.reps[`${id}:meaning`] ?? 0) >= 2 }))
            .sort((a, b) => Number(b.known) - Number(a.known))
            .slice(0, 5), total: others.length }];
    });
  }

  card(id: number): Card {
    const card = this.state.cards.find((c) => c.id === id);
    if (!card) throw new Error("not_found");
    return card;
  }

  updateCard(id: number, patch: CardPatch): Card {
    const card = this.card(id);
    const clear = (v: string | undefined, old: string | null) => (v === undefined ? old : v || null);
    Object.assign(card, {
      ...(patch.korean !== undefined && { korean: normalizeKorean(patch.korean), readyForSpeech: isKoreanOnly(patch.korean) }),
      ...(patch.meaning !== undefined && { meaning: patch.meaning }),
      pronunciation: clear(patch.pronunciation, card.pronunciation),
      romanization: clear(patch.romanization, card.romanization),
      notes: clear(patch.notes, card.notes),
      ...(patch.examples && { examples: patch.examples }),
      ...(patch.tags && { tags: patch.tags }),
      ...(patch.suspended !== undefined && { suspended: patch.suspended }),
      updatedAt: this.now().toISOString(),
    });
    if (patch.speakable !== undefined) card.speakable = patch.speakable && card.readyForSpeech;
    this.save();
    return card;
  }

  deleteCard(id: number): { ok: true } {
    this.state.cards = this.state.cards.filter((c) => c.id !== id);
    this.save();
    return { ok: true };
  }

  introduce(id: number): Card {
    const card = this.card(id);
    card.queued = false;
    const at = this.now().toISOString();
    this.state.due[`${id}:meaning`] = at;
    this.state.due[`${id}:speech`] = at;
    this.state.due[`${id}:listening`] = at;
    this.save();
    return card;
  }

  settings(): Settings {
    return { newPerDay: this.state.newPerDay };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    if (patch.newPerDay !== undefined) this.state.newPerDay = patch.newPerDay;
    this.save();
    return this.settings();
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

  queue(mode: QueueMode, limit = 50, anyDue = false, modes: ReviewMode[] = ["meaning", "speech", "listening"]): QueueItem[] {
    if (mode === "mixed") {
      return modes
        .flatMap((m) => this.queue(m, limit, anyDue))
        .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
        .slice(0, limit)
        .sort(() => Math.random() - 0.5);
    }
    const now = this.now().getTime();
    return this.state.cards
      // No recordings in the mock: listening falls back to the phone's voice for every Hangul card.
      .filter((c) => !c.queued && !c.suspended && (mode === "speech" ? c.speakable : mode === "listening" ? c.readyForSpeech : true))
      .map((card) => {
        const key = `${card.id}:${mode}`;
        // Saved before listening mode existed: due from the card's creation.
        const due = this.state.due[key] ?? card.createdAt;
        const reps = this.state.reps[key] ?? 0;
        return { card, mode, due, state: reps ? 2 : 0, reps, lapses: 0 };
      })
      .filter((item) => anyDue || Date.parse(item.due) <= now)
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
      .slice(0, limit);
  }

  /** Any three other cards; the server picks look-alike ones. */
  choices(cardIds: number[]): Record<number, ChoiceOption[]> {
    const pool = this.state.cards.filter((c) => !c.queued);
    return Object.fromEntries(
      cardIds.map((id) => [
        id,
        pool
          .filter((c) => c.id !== id)
          .sort(() => Math.random() - 0.5)
          .slice(0, 3)
          .map(({ id, korean, meaning }) => ({ id, korean, meaning })),
      ]),
    );
  }

  group(mode: QueueMode, filter: GroupFilter, modes?: ReviewMode[]): { items: QueueItem[]; total: number } {
    const ids = new Set(this.cards({ ...filter, limit: Infinity }).cards.filter((c) => !c.suspended).map((c) => c.id));
    for (const card of this.state.cards) if (ids.has(card.id) && card.queued) card.queued = false;
    this.save();
    const items = this.queue(mode, Infinity, true, modes)
      .filter((item) => ids.has(item.card.id))
      .sort(() => Math.random() - 0.5);
    return { items, total: ids.size };
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

  private retention: Record<ReviewMode, number> = { meaning: 0.9, speech: 0.9, listening: 0.9 };

  fsrs(): FsrsStatus {
    return {
      modes: (["meaning", "speech", "listening"] as const).map((mode) => ({
        mode,
        desiredRetention: this.retention[mode],
        personal: false,
        reviews: this.state.reviewIds.length,
        minReviews: 1000,
        trainedOnReviews: null,
        optimizedAt: null,
      })),
      retentionRange: { min: 0.85, max: 0.95 },
    };
  }

  setRetention(mode: ReviewMode, retention: number): FsrsStatus {
    this.retention[mode] = retention;
    return this.fsrs();
  }

  stats(): Stats {
    const day = this.now().toISOString().slice(0, 10);
    return {
      cards: this.state.cards.length,
      due: {
        meaning: this.queue("meaning", Infinity).length,
        speech: this.queue("speech", Infinity).length,
        listening: this.queue("listening", Infinity).length,
      },
      reviewedToday: this.state.reviewedToday.day === day ? this.state.reviewedToday.count : 0,
      newCards: { introduced: 0, limit: this.state.newPerDay, queued: this.state.cards.filter((c) => c.queued).length },
    };
  }

  /** Made-up but plausible history, deterministic, so the statistics screen can be designed. */
  statsOverview(): StatsOverview {
    const today = new Date(this.now());
    today.setHours(12, 0, 0, 0);
    const day = (offset: number) => {
      const d = new Date(today.getTime() + offset * DAY);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const activity = Array.from({ length: 119 }, (_, i) => {
      const age = 118 - i;
      const skip = age > 60 ? rand() < 0.6 : age === 9 || age === 23 || rand() < 0.08;
      return { day: day(-age), reviews: skip || age === 0 ? 0 : Math.round(8 + rand() * 50 * (1 - age / 200)) };
    });
    const forecast = Array.from({ length: 30 }, (_, i) => ({
      day: day(i),
      due: {
        meaning: Math.round((i === 0 ? 34 : 6 + rand() * 22) * (i === 9 ? 2.4 : 1)),
        speech: Math.round(i === 0 ? 12 : 2 + rand() * 10),
        listening: Math.round(i === 0 ? 8 : 1 + rand() * 8),
      },
    }));
    return {
      today: day(0),
      streak: { current: 8, best: 21, reviewedToday: false },
      activity,
      forecast,
      retention: { meaning: { reviews: 412, recalled: 361 }, speech: { reviews: 96, recalled: 88 }, listening: { reviews: 64, recalled: 51 } },
      targetRetention: { meaning: 0.9, speech: 0.9, listening: 0.88 },
      cards: {
        total: 238,
        byMode: {
          meaning: { new: 31, learning: 14, young: 121, mature: 72 },
          speech: { new: 58, learning: 9, young: 118, mature: 41 },
          listening: { new: 90, learning: 12, young: 104, mature: 22 },
        },
      },
      speech: {
        weeks: [61, 64, null, 68, 71, 70, 76, 79].map((avg, i) => ({
          start: day(-(7 - i) * 7 - 6),
          attempts: avg === null ? 0 : 20 + i * 4,
          avgScore: avg,
        })),
        sounds: [
          { phone: "t͈ɕ", attempts: 48, errors: 19, recent: { attempts: 14, errors: 3 }, previous: { attempts: 12, errors: 6 } },
          { phone: "ʌ", attempts: 160, errors: 52, recent: { attempts: 40, errors: 12 }, previous: { attempts: 38, errors: 13 } },
          { phone: "kʰ", attempts: 61, errors: 17, recent: { attempts: 18, errors: 7 }, previous: { attempts: 15, errors: 3 } },
          { phone: "ɰi", attempts: 22, errors: 6, recent: { attempts: 0, errors: 0 }, previous: { attempts: 6, errors: 2 } },
          { phone: "s͈", attempts: 37, errors: 8, recent: { attempts: 11, errors: 1 }, previous: { attempts: 9, errors: 3 } },
        ],
      },
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
      roots: input.roots ?? null,
      speakable: readyForSpeech && syllables > 0 && syllables <= 12,
      readyForSpeech,
      source,
      suspended: false,
      queued: source === "claude",
      createdAt: at,
      updatedAt: at,
    };
    this.state.cards.push(card);
    if (!card.queued) {
      this.state.due[`${card.id}:meaning`] = at;
      this.state.due[`${card.id}:speech`] = at;
      this.state.due[`${card.id}:listening`] = at;
    }
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
