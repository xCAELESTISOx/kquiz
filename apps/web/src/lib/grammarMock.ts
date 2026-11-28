// Grammar for the dev mock (lib/mock.ts): a few constructions, so the screens work without an api.
import type { GrammarAnswerInput, GrammarStats } from "./api";
import type { GrammarPoint, GrammarSentence } from "./grammar";

const HOUR = 3_600_000;
let nextSentence = 1;
const s = (ko: string, translation: string, extra: Partial<NonNullable<GrammarSentence["slot"]>> = {}): GrammarSentence => {
  const m = ko.match(/^(.*)\{(.+)\}(.*)$/);
  return {
    id: nextSentence++,
    before: m ? m[1]! : ko,
    after: m ? m[3]! : "",
    // As the server does: a question mark makes the sentence a question.
    slot: m ? { lemma: m[2]!, pos: "verb", pattern: "", final: m[3]!.includes("?") ? { question: true } : {}, ...extra } : null,
    translation,
  };
};

function point(id: number, pattern: string, meaning: string, sentences: GrammarSentence[], extra: Partial<GrammarPoint> = {}): GrammarPoint {
  return {
    id,
    pattern,
    meaning,
    goal: "use",
    explanation: null,
    trap: null,
    tags: ["урок 1"],
    status: "pool",
    learnStep: 0,
    ladder: 4,
    checkAt: null,
    due: null,
    reps: 0,
    lapses: 0,
    sentences: sentences.map((x) => (x.slot && !x.slot.pattern ? { ...x, slot: { ...x.slot, pattern } } : x)),
    similar: [],
    createdAt: new Date(Date.now() - (10 - id) * HOUR).toISOString(),
    ...extra,
  };
}

export function sampleGrammar(): GrammarPoint[] {
  return [
    point(
      1,
      "-아/어야 하다",
      "надо, должен",
      [
        s("외국인등록증을 {가져가다}.", "Нужно взять с собой ID-карту иностранца."),
        s("이사 가기 전에 집주인에게 {말하다}.", "Перед переездом надо сказать хозяину квартиры."),
        s("수업 전에 이 노래를 {듣다}.", "До урока нужно послушать эту песню."),
        s("내일까지 색깔을 {고르다}.", "До завтра нужно выбрать цвет."),
        s("친구를 {돕다}.", "Нужно помочь другу."),
      ],
      {
        explanation: "Обязанность или необходимость. В разговоре вместо 하다 часто 되다: 가야 돼요.",
        trap: "✗ 안 가야 해요 (= надо не ходить) ✓ 안 가도 돼요 (можно не ходить)",
        similar: [{ id: 2, pattern: "-(으)ㄹ 수 있다", note: "надо / можно" }],
      },
    ),
    point(
      2,
      "-(으)ㄹ 수 있다",
      "можно, могу",
      [
        s("카드로 {결제하다}?", "Можно оплатить картой?"),
        s("외국인도 운전면허 시험을 {보다}?", "Иностранцы тоже могут сдавать на права?"),
        s("여기에서 음악을 {듣다}.", "Здесь можно слушать музыку."),
        s("저는 김치찌개를 {만들다}.", "Я умею готовить кимчи-чиге."),
      ],
      { trap: "✗ 갈수있어요 ✓ 갈 수 있어요: 수 пишется отдельно" },
    ),
    point(
      3,
      "-기로 하다",
      "решить, договориться",
      [
        s("한국에서 계속 {살다}.", "Я решил остаться жить в Корее.", { final: { tense: "past" } }),
        s("주말에 친구와 등산을 {가다}.", "Договорились с другом пойти в горы на выходных.", { final: { tense: "past" } }),
        s("내일부터 운동을 {하다}.", "Решил с завтрашнего дня заниматься спортом.", { final: { tense: "past" } }),
        s("다음 달에 이사를 {가다}.", "Решили переехать в следующем месяце.", { final: { tense: "past" } }),
      ],
    ),
  ];
}

/** The server's rules, roughly: enough to click through a session in dev. */
export class GrammarMock {
  points = sampleGrammar();

  list() {
    return { points: this.points };
  }

  start(id: number) {
    const p = this.points.find((x) => x.id === id)!;
    if (p.status === "pool") Object.assign(p, { status: "learning", learnStep: 0 });
    return { point: p };
  }

  answer(answers: GrammarAnswerInput[]) {
    for (const a of answers) {
      const p = this.points.find((x) => x.id === a.pointId);
      if (!p || a.phase !== "learn" || p.status !== "learning") continue;
      p.learnStep = a.outcome === "wrong" ? Math.max(0, p.learnStep - 1) : p.learnStep + 1;
      if (p.learnStep >= p.ladder) Object.assign(p, { status: "checking", checkAt: new Date(Date.now() + 3 * HOUR).toISOString() });
    }
    return { applied: answers.length, points: this.points.filter((p) => answers.some((a) => a.pointId === p.id)) };
  }

  stats(): GrammarStats {
    const count = (st: GrammarPoint["status"]) => this.points.filter((p) => p.status === st).length;
    return {
      total: this.points.length,
      learned: count("learned"),
      learning: count("learning"),
      checking: count("checking"),
      pool: count("pool"),
      dueNow: 0,
      tasks: [],
      classes: [],
      missed: [],
      learnedDays: [],
    };
  }
}
