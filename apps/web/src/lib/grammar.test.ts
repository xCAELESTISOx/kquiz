import { describe, expect, it } from "vitest";
import { buildTiles, checkTyped, chooseOptions, formationRows, planSession, pointsToStart, sentenceText, understandOptions, whyWrong, type GrammarPoint } from "./grammar";
import { sampleGrammar } from "./grammarMock";

// A fixed "random" so shuffles are repeatable.
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const now = new Date("2026-11-28T10:00:00Z");

function points(): GrammarPoint[] {
  const [must, can, decide] = sampleGrammar();
  return [
    { ...must!, status: "learning", learnStep: 0 },
    { ...can!, status: "learning", learnStep: 2 },
    { ...decide!, status: "learned", due: "2026-11-28T09:00:00Z", reps: 3 },
  ];
}

describe("planSession", () => {
  it("meets a new construction before its ladder and spreads the constructions out", () => {
    const tasks = planSession(points(), now, seeded());
    const seq = tasks.map((t) => `${t.point.id}:${t.kind}`);
    expect(seq[0]).toBe("3:understand");
    expect(seq.filter((s) => s.startsWith("1:"))).toEqual(["1:intro", "1:understand", "1:choose", "1:build", "1:type"]);
    expect(seq.filter((s) => s.startsWith("2:"))).toEqual(["2:build", "2:type"]);
    // While two constructions are left, the same one never comes twice in a row.
    const lastTwo = tasks.findIndex((_, i) => new Set(tasks.slice(i).map((t) => t.point.id)).size < 2);
    for (let i = 1; i < lastTwo; i++) expect(tasks[i]!.point.id).not.toBe(tasks[i - 1]!.point.id);
    // No sentence twice.
    const ids = tasks.map((t) => t.sentence.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("checks constructions whose wait is over, and only those", () => {
    const [must] = sampleGrammar();
    const later = { ...must!, status: "checking" as const, checkAt: "2026-11-28T12:00:00Z" };
    expect(planSession([later], now)).toEqual([]);
    const ready = { ...later, checkAt: "2026-11-28T09:00:00Z" };
    expect(planSession([ready], now).map((t) => [t.kind, t.phase])).toEqual([["type", "check"]]);
  });

  it("takes new ones from the pool up to two on the ladder", () => {
    expect(pointsToStart(sampleGrammar()).map((p) => p.id)).toEqual([1, 2]);
    expect(pointsToStart(points())).toEqual([]);
  });
});

describe("tasks", () => {
  const [must, can] = sampleGrammar();
  const listen = must!.sentences.find((s) => s.slot?.lemma === "듣다")!;

  it("builds the sentence by rule", () => {
    expect(sentenceText(listen)).toBe("수업 전에 이 노래를 들어야 합니다.");
    expect(sentenceText(can!.sentences[0]!)).toBe("카드로 결제할 수 있습니까?");
  });

  it("offers the right form among real mistakes and a neighbouring construction", () => {
    const options = chooseOptions(listen, must!, sampleGrammar(), seeded());
    expect(options.filter((o) => o.right).map((o) => o.form)).toEqual(["들어야 합니다"]);
    expect(options.map((o) => o.form)).toEqual(expect.arrayContaining(["듣어야 합니다", "들을 수 있습니다"]));
    expect(new Set(options.map((o) => o.form)).size).toBe(options.length);
  });

  it("asks for the sense among other constructions' senses", () => {
    const options = understandOptions(must!, sampleGrammar(), seeded());
    expect(options.map((o) => o.meaning).sort()).toEqual(["можно, могу", "надо, должен", "решить, договориться"].sort());
  });

  it("gives tiles with a wrong form among them", () => {
    const { answer, bank } = buildTiles(listen, seeded());
    expect(answer).toEqual(["수업", "전에", "이", "노래를", "들어야", "합니다."]);
    expect(bank).toEqual(expect.arrayContaining([...answer, "듣어야"]));
  });

  it("takes another style as almost right and explains a mistake", () => {
    expect(checkTyped("들어야 합니다", listen.slot!)).toBe("right");
    expect(checkTyped("들어야 해요", listen.slot!)).toBe("style");
    expect(checkTyped("들어야합니다", listen.slot!)).toBe("spacing");
    expect(checkTyped("듣어야 합니다", listen.slot!)).toBe("wrong");
    expect(whyWrong(listen.slot!, "듣어야 합니다")).toBe("Irregular. ㄷ becomes ㄹ before a vowel: 듣다 → 들어요, 들은");
  });

  it("shows how the construction goes on the point's own words, irregular ones first", () => {
    const rows = formationRows(must!);
    expect(rows[0]).toMatchObject({ lemma: "듣다", form: "들어야 합니다" });
    expect(rows.map((r) => r.lemma)).toEqual(expect.arrayContaining(["돕다", "고르다"]));
    expect(rows).toHaveLength(4);
  });
});
