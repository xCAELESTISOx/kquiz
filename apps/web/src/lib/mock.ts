import { isKoreanOnly, normalizeKorean } from "./korean";
import { fallbackTiles } from "./phrase";
import type {
  LearningAnswer,
  LearningItem,
  AddCardResult,
  AddCardsResult,
  Card,
  CardFilter,
  CardKind,
  CardList,
  CardPatch,
  CardSource,
  CardSummary,
  ChoiceOption,
  Family,
  FsrsStatus,
  GroupFilter,
  PhraseTiles,
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
  /** New words being learned (apps/api newCards.ts): since when, the ladder step, when it was climbed. */
  learn?: Record<number, { at: string | null; step: number; passedAt: string | null }>;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "kquiz.mock.v5";

const ACTIVE_WORDS = 3;
const IN_PROGRESS_LIMIT = 5;
const LADDER_STEPS = 3;
const CHECK_AFTER = 3 * 3_600_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function root(ko: string, hanja: string, meaning: string) {
  return { ko, hanja, meaning };
}

const SEED: NewCard[] = [
  { korean: "안녕하세요", meaning: "hello", pronunciation: "안녕하세요", romanization: "annyeonghaseyo", examples: [
      { ko: "선생님, 안녕하세요!", ru: "Hello, teacher!" },
      { ko: "여러분, 안녕하세요.", ru: "Hello, everyone." },
      { ko: "안녕하세요, 처음 뵙겠습니다.", ru: "Hello, nice to meet you." },
    ] },
  { korean: "감사합니다", meaning: "thank you", pronunciation: "감사함니다", romanization: "gamsahamnida" },
  { korean: "물", meaning: "water", romanization: "mul", examples: [{ ko: "물 좀 주세요.", ru: "Some water, please." }] },
  { korean: "괜찮아요", meaning: "it's okay", pronunciation: "괜차나요", romanization: "gwaenchanayo" },
  { korean: "맛있다", meaning: "tasty", pronunciation: "마싣따", romanization: "masitda", tags: ["food"], roots: [] },
  { korean: "학교", meaning: "school", pronunciation: "학꾜", tags: ["study"], roots: [root("학", "學", "study"), root("교", "校", "school")], examples: [
      { ko: "학교에 가요.", ru: "I'm going to school." },
      { ko: "우리 학교는 커요.", ru: "Our school is big." },
      { ko: "학교 앞에서 만나요.", ru: "Let's meet in front of the school." },
    ] },
  { korean: "학생", meaning: "student", pronunciation: "학쌩", tags: ["study"], roots: [root("학", "學", "study"), root("생", "生", "life, birth")] },
  { korean: "대학교", meaning: "university", pronunciation: "대학꾜", tags: ["study"], roots: [root("대", "大", "big"), root("학", "學", "study"), root("교", "校", "school")] },
  { korean: "선생님", meaning: "teacher", tags: ["study"], roots: [root("선", "先", "before"), root("생", "生", "life, birth")] },
  { korean: "가다", meaning: "to go", tags: ["verbs"], roots: [] },
  { korean: "화장실", meaning: "restroom", roots: [root("화", "化", "change"), root("장", "粧", "adorn"), root("실", "室", "room")] },
  { korean: "어디", meaning: "where", roots: [] },
  { korean: "화장실이 어디예요?", meaning: "Where is the restroom?", kind: "phrase", register: "polite", notes: "In a café, in the subway, at someone's home.", parts: [
      { ko: "화장실이", base: "화장실", meaning: "restroom (+이)" },
      { ko: "어디예요", base: "어디", meaning: "where (+예요)" },
    ] },
  { korean: "안녕히 가세요", meaning: "Goodbye (to someone leaving)", kind: "phrase", register: "polite", notes: "Said by the one who stays. The one leaving answers 안녕히 계세요.", parts: [
      { ko: "안녕히", meaning: "peacefully, well" },
      { ko: "가세요", base: "가다", meaning: "go (polite)" },
    ] },
  { korean: "잘 먹겠습니다", meaning: "Thank you for the meal (before eating)", kind: "phrase", register: "formal", notes: "Before a meal, especially when someone treats you.", parts: [
      { ko: "잘", meaning: "well" },
      { ko: "먹겠습니다", base: "먹다", meaning: "will eat" },
    ] },
  { korean: "죄송합니다, 저는 아직 한국어를 배우고 있습니다", meaning: "Sorry, I'm still learning Korean", kind: "phrase", register: "formal", parts: [
      { ko: "죄송합니다", base: "죄송하다", meaning: "sorry" },
      { ko: "저는", base: "저", meaning: "I (+는)" },
      { ko: "아직", meaning: "still, yet" },
      { ko: "한국어를", base: "한국어", meaning: "Korean language (+를)" },
      { ko: "배우고 있습니다", base: "배우다", meaning: "am learning (now)" },
    ] },
  { korean: "어떻게 지내요?", meaning: "How are you doing?", kind: "phrase", register: "polite", parts: [
      { ko: "어떻게", meaning: "how" },
      { ko: "지내요", base: "지내다", meaning: "to get along" },
    ] },
];

// As if Claude had just added them: they wait in the new-card queue.
const SEED_QUEUED: NewCard[] = [
  { korean: "지하철", meaning: "subway", tags: ["city"], roots: [root("지", "地", "earth"), root("하", "下", "below"), root("철", "鐵", "iron")] },
  { korean: "편의점", meaning: "convenience store", pronunciation: "펴니점", tags: ["city"] },
  { korean: "영수증", meaning: "receipt", tags: ["shopping"] },
  { korean: "계산하다", meaning: "to pay, to count", tags: ["shopping", "verbs"] },
];

// A few of the server's grammar look-alikes (apps/api/src/phrases.ts), so the mock's wrong blocks look real.
const MOCK_SWAPS: [string, string][] = [
  ["예요", "이에요"],
  ["습니다", "어요"],
  ["세요", "셨어요"],
  ["이", "을"],
  ["요", ""],
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
      // The sample deck is already learned; the queued sample is a lesson still to learn.
      for (const card of SEED) this.insert(card, "app", true);
      for (const card of SEED_QUEUED) this.insert(card, "claude");
    }
  }

  cards(query: { q?: string; tag?: string; root?: string; status?: CardFilter; kind?: CardKind; before?: number; limit?: number }): CardList {
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
          (!query.kind || c.kind === query.kind) &&
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
        phrases: this.state.cards.filter((c) => c.kind === "phrase").length,
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

  /** A phrase's pieces linked to the words, as GET /api/cards/:id gives them. */
  linkedCard(id: number): Card {
    const card = this.card(id);
    if (!card.parts) return card;
    const parts = card.parts.map((p) => {
      const word = this.state.cards.find((c) => c.kind === "word" && (c.korean === p.base || c.korean === p.ko));
      return word ? { ...p, cardId: word.id } : p;
    });
    return { ...card, parts };
  }

  /** The phrase's words and a few blocks of other phrases; the server also makes grammar look-alikes. */
  blocks(cardIds: number[]): Record<number, PhraseTiles> {
    const phrases = this.state.cards.filter((c) => c.kind === "phrase");
    return Object.fromEntries(
      phrases
        .filter((c) => cardIds.includes(c.id))
        .map((card) => {
          const { blocks } = fallbackTiles(card);
          const others = phrases.filter((c) => c.id !== card.id).flatMap((c) => fallbackTiles(c).blocks);
          const lookAlikes = blocks.flatMap((b) => MOCK_SWAPS.flatMap(([end, other]) => (b.endsWith(end) && b.length > end.length ? [b.slice(0, -end.length) + other] : [])));
          const decoys = [...new Set([...lookAlikes.slice(0, 2), ...others.sort(() => Math.random() - 0.5)])]
            .filter((b) => !blocks.includes(b))
            .slice(0, 4);
          return [card.id, { blocks, decoys }];
        }),
    );
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
      ...(patch.register && { register: patch.register }),
      updatedAt: this.now().toISOString(),
    });
    if (patch.speakable !== undefined) card.speakable = patch.speakable && card.readyForSpeech;
    this.save();
    return card;
  }

  linkSimilar(id: number, otherId: number, note?: string): Card {
    const [card, other] = [this.card(id), this.card(otherId)];
    if (id === otherId) throw new Error("same_card");
    const old = card.similar?.find((s) => s.id === otherId)?.note ?? null;
    const kept = note === undefined ? old : note.trim() || null;
    card.similar = [...(card.similar ?? []).filter((s) => s.id !== otherId), { id: other.id, korean: other.korean, meaning: other.meaning, note: kept }];
    other.similar = [...(other.similar ?? []).filter((s) => s.id !== id), { id: card.id, korean: card.korean, meaning: card.meaning, note: kept }];
    this.save();
    return card;
  }

  unlinkSimilar(id: number, otherId: number): Card {
    const card = this.card(id);
    card.similar = card.similar?.filter((s) => s.id !== otherId);
    const other = this.state.cards.find((c) => c.id === otherId);
    if (other) other.similar = other.similar?.filter((s) => s.id !== id);
    this.save();
    return card;
  }

  deleteCard(id: number): { ok: true } {
    this.state.cards = this.state.cards.filter((c) => c.id !== id);
    for (const c of this.state.cards) c.similar = c.similar?.filter((s) => s.id !== id);
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

  learned(ids: number[], missed: number[]): { introduced: number[] } {
    const introduced: number[] = [];
    const tomorrow = new Date(this.now());
    tomorrow.setHours(24, 0, 0, 0);
    for (const card of this.state.cards) {
      if (!ids.includes(card.id) || !card.queued) continue;
      card.queued = false;
      const at = (missed.includes(card.id) ? new Date(Math.min(this.now().getTime() + 2 * 3_600_000, tomorrow.getTime())) : tomorrow).toISOString();
      for (const mode of ["meaning", "speech", "listening"]) this.state.due[`${card.id}:${mode}`] = at;
      introduced.push(card.id);
    }
    this.save();
    return { introduced };
  }

  /** How many new words may start: a free place on the ladder, and few enough unfinished. */
  private room(): number {
    const learn = this.state.learn ?? {};
    const waiting = this.state.cards.filter((c) => c.queued && !c.suspended);
    const active = waiting.filter((c) => learn[c.id]?.at && !learn[c.id]!.passedAt).length;
    const passed = waiting.filter((c) => learn[c.id]?.passedAt).length;
    const pool = waiting.filter((c) => !learn[c.id]).length;
    return Math.max(0, Math.min(ACTIVE_WORDS - active, IN_PROGRESS_LIMIT - active - passed, pool));
  }

  learning(): { items: LearningItem[]; pool: number } {
    const learn = (this.state.learn ??= {});
    const waiting = this.state.cards.filter((c) => c.queued && !c.suspended).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
    const now = this.now().getTime();
    const checks = waiting.filter((c) => learn[c.id]?.passedAt && now - Date.parse(learn[c.id]!.passedAt!) >= CHECK_AFTER);
    const active = waiting.filter((c) => learn[c.id]?.at && !learn[c.id]!.passedAt);
    for (const card of waiting) {
      if (this.room() <= 0) break;
      if (learn[card.id]) continue;
      learn[card.id] = { at: this.now().toISOString(), step: 0, passedAt: null };
      active.push(card);
    }
    this.save();
    return {
      items: [...checks.map((card) => ({ card, step: "check" as const })), ...active.map((card) => ({ card, step: learn[card.id]!.step }))],
      pool: waiting.filter((c) => !learn[c.id]).length,
    };
  }

  answerLearning(id: number, ok: boolean): LearningAnswer {
    const learn = (this.state.learn ??= {});
    const at = this.now().toISOString();
    const word = (learn[id] ??= { at, step: 0, passedAt: null });
    let answer: LearningAnswer;
    if (!ok) {
      word.step = word.passedAt ? LADDER_STEPS - 1 : Math.max(word.step - 1, 0);
      word.passedAt = null;
      word.at ??= at;
      answer = { status: "missed", step: word.step };
    } else if (word.passedAt) {
      delete learn[id];
      this.learned([id], []);
      answer = { status: "learned", due: this.state.due[`${id}:meaning`]! };
    } else if (word.step + 1 < LADDER_STEPS) {
      word.step++;
      answer = { status: "climbed", step: word.step };
    } else {
      word.step++;
      word.passedAt = at;
      word.at = null;
      const next = this.room() > 0
        ? this.state.cards
            .filter((c) => c.queued && !c.suspended && !learn[c.id])
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)[0]
        : undefined;
      if (next) learn[next.id] = { at, step: 0, passedAt: null };
      answer = { status: "passed", next: next ? { card: next, step: 0 } : null };
    }
    this.save();
    return answer;
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
      .filter((c) => !c.queued && !c.suspended && (mode === "speech" ? c.speakable && c.kind === "word" : mode === "listening" ? c.readyForSpeech : true))
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

  /** A similar word, if any, then any other cards; the server picks look-alike ones. */
  choices(cardIds: number[]): Record<number, ChoiceOption[]> {
    const pool = this.state.cards.filter((c) => !c.queued);
    return Object.fromEntries(
      cardIds.map((id) => {
        const similar = (this.state.cards.find((c) => c.id === id)?.similar ?? []).slice(0, 1);
        const others = pool
          .filter((c) => c.id !== id && !similar.some((s) => s.id === c.id))
          .sort(() => Math.random() - 0.5)
          .slice(0, 3 - similar.length);
        return [id, [...similar, ...others].map(({ id, korean, meaning }) => ({ id, korean, meaning }))];
      }),
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
      dueWords: new Set(this.queue("mixed", Infinity).map((i) => i.card.id)).size,
      reviewedToday: this.state.reviewedToday.day === day ? this.state.reviewedToday.count : 0,
      learned: this.state.cards.filter((c) => !c.queued && !c.suspended).length,
      learnedToday: 0,
      newCards: {
        queued: this.state.cards.filter((c) => c.queued).length,
        learning: this.state.cards.filter((c) => c.queued && !c.suspended && (this.state.learn?.[c.id]?.at || this.state.learn?.[c.id]?.passedAt)).length,
        next: this.state.cards
          .filter((c) => c.queued && !c.suspended)
          .sort((a, b) => Number(!this.state.learn?.[a.id]?.at) - Number(!this.state.learn?.[b.id]?.at) || a.id - b.id)
          .filter((c) => this.state.learn?.[c.id]?.at)
          .concat(this.state.cards.filter((c) => c.queued && !c.suspended && !this.state.learn?.[c.id]).slice(0, this.room()))
          .slice(0, 12)
          .map((c) => c.korean),
        started: this.state.cards.filter((c) => c.queued && !c.suspended && this.state.learn?.[c.id]?.at).length,
        fresh: this.room(),
        pool: this.state.cards.filter((c) => c.queued && !c.suspended && !this.state.learn?.[c.id]).length,
      },
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
    // A small deck, like the owner's after a couple of lessons: reviews thin out as intervals grow.
    const forecast = Array.from({ length: 30 }, (_, i) => {
      const fade = 1 / (1 + i / 6);
      const meaning = i === 0 ? 4 : rand() < 0.35 ? 0 : Math.round(1 + rand() * 6 * fade);
      const speech = i === 0 ? 3 : Math.round(rand() * 3 * fade);
      const listening = i === 0 ? 2 : Math.round(rand() * 2 * fade);
      return { day: day(i), due: { meaning, speech, listening }, words: Math.max(meaning, speech, listening, i === 0 ? 5 : 0) };
    });
    const history = Array.from({ length: 15 }, (_, i) => ({ day: day(i - 15), words: i === 6 ? 0 : Math.round(3 + rand() * 9) }));
    return {
      today: day(0),
      history,
      streak: { current: 8, best: 21, reviewedToday: false },
      activity,
      forecast,
      learned: 12,
      learning: 4,
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

  private insert(input: NewCard, source: CardSource, learned = false): AddCardResult {
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
      kind: input.kind ?? "word",
      parts: input.parts ?? null,
      register: input.register ?? null,
      speakable: readyForSpeech && syllables > 0 && syllables <= 12,
      readyForSpeech,
      source,
      suspended: false,
      queued: !learned,
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
