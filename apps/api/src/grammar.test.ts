import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDb } from "./db/client.js";
import { addGrammar, applyAnswers, CHECK_AFTER, findGrammar, grammarStats, LADDER_USE, linkSimilarGrammar, listGrammar, parseSentence, startLearning, updateGrammar, type GrammarAnswer } from "./grammar.js";
import { testApp } from "./testing.js";
import { OWNER_ID } from "./users.js";

const sentences = (lemmas: string[]) => lemmas.map((l) => ({ ko: `내일까지 {${l}}.`, translation: "до завтра" }));

const mustPoint = {
  pattern: "-아/어야 하다",
  meaning: "надо, должен",
  explanation: "Обязанность.",
  trap: "✗ 안 가야 해요 ✓ 안 가도 돼요",
  tags: ["Урок 1"],
  sentences: sentences(["듣다", "돕다", "가다", "고르다"]),
};

const answer = (pointId: number, phase: GrammarAnswer["phase"], outcome: GrammarAnswer["outcome"], at: Date, task: GrammarAnswer["task"] = "choose"): GrammarAnswer => ({
  id: randomUUID(),
  pointId,
  task,
  phase,
  outcome,
  answeredAt: at,
});

describe("parseSentence", () => {
  it("builds the form from the word in braces", () => {
    expect(parseSentence({ ko: "외국인등록증을 {가져가다}.", translation: "…" }, "-아/어야 하다", "use").shown).toBe("외국인등록증을 가져가야 합니다.");
    expect(parseSentence({ ko: "카드로 {결제하다}?", translation: "…", final: { style: "polite" } }, "-(으)ㄹ 수 있다", "use").shown).toBe("카드로 결제할 수 있어요?");
    expect(parseSentence({ ko: "{선거} 국회가 분주합니다.", translation: "…", pos: "noun" }, "-을/를 앞두고", "use").shown).toBe("선거를 앞두고 국회가 분주합니다.");
    expect(parseSentence({ ko: "카드로 {결제하다}?", translation: "…" }, "-(으)ㄹ 수 있다", "use").shown).toBe("카드로 결제할 수 있습니까?");
  });

  it("refuses a sentence without the word, unless the construction is only read", () => {
    expect(() => parseSentence({ ko: "가야 합니다.", translation: "…" }, "-아/어야 하다", "use")).toThrow(/braces/);
    expect(parseSentence({ ko: "물가 또 올라", translation: "…" }, "заголовок", "recognize").slot).toBeNull();
    expect(() => parseSentence({ ko: "{가야}.", translation: "…" }, "-아/어야 하다", "use")).toThrow(/dictionary form/);
  });
});

describe("adding and editing", () => {
  it("adds constructions to the pool and reports duplicates and bad ones", () => {
    const db = openDb(":memory:");
    const result = addGrammar(db, OWNER_ID, [mustPoint, mustPoint, { ...mustPoint, pattern: "-고 있다", sentences: sentences(["가다"]) }]);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]!.sentences).toEqual(["내일까지 들어야 합니다.", "내일까지 도와야 합니다.", "내일까지 가야 합니다.", "내일까지 골라야 합니다."]);
    expect(result.duplicates).toEqual([{ id: result.created[0]!.id, pattern: "-아/어야 하다" }]);
    expect(result.rejected[0]!.pattern).toBe("-고 있다");
    const [point] = listGrammar(db, OWNER_ID);
    expect(point).toMatchObject({ status: "pool", tags: ["урок 1"], ladder: LADDER_USE });
    expect(point!.sentences[0]!.slot).toEqual({ lemma: "듣다", pos: "verb", pattern: "-아/어야 하다", final: {} });
  });

  it("replaces sentences and renames the pattern for them too", () => {
    const db = openDb(":memory:");
    const id = addGrammar(db, OWNER_ID, [mustPoint]).created[0]!.id;
    const result = updateGrammar(db, OWNER_ID, id, { pattern: "-아/어야 되다", sentences: sentences(["먹다", "쓰다", "살다", "짓다"]) });
    expect(result).toEqual({ ok: true, sentences: ["내일까지 먹어야 됩니다.", "내일까지 써야 됩니다.", "내일까지 살아야 됩니다.", "내일까지 지어야 됩니다."] });
    expect(updateGrammar(db, OWNER_ID, id, { trap: "" })).toEqual({ ok: true });
    expect(findGrammar(db, OWNER_ID, { limit: 5 })[0]).toMatchObject({ pattern: "-아/어야 되다", trap: null });
    expect(updateGrammar(db, OWNER_ID, 999, { meaning: "x" })).toEqual({ ok: false, reason: "not found" });
  });

  it("links similar constructions both ways", () => {
    const db = openDb(":memory:");
    addGrammar(db, OWNER_ID, [mustPoint, { ...mustPoint, pattern: "-아/어도 되다", meaning: "можно" }]);
    expect(linkSimilarGrammar(db, OWNER_ID, [{ pattern: "-아/어도 되다", other: "-아/어야 하다", note: "можно / надо" }, { pattern: "x", other: "-아/어야 하다" }])).toMatchObject({ linked: [["-아/어도 되다", "-아/어야 하다"]], rejected: [{ reason: "not found" }] });
    const [a, b] = listGrammar(db, OWNER_ID);
    expect(a!.similar).toEqual([{ id: b!.id, pattern: "-아/어도 되다", note: "можно / надо" }]);
    expect(b!.similar[0]!.id).toBe(a!.id);
  });
});

describe("learning", () => {
  it("climbs the ladder, waits, is checked and enters reviews", () => {
    const db = openDb(":memory:");
    const t0 = new Date("2026-11-28T10:00:00Z");
    const ids = addGrammar(db, OWNER_ID, [mustPoint, { ...mustPoint, pattern: "-기로 하다" }, { ...mustPoint, pattern: "-고 있다" }], t0).created.map((c) => c.id);
    expect(startLearning(db, OWNER_ID, ids[0]!, t0)).toEqual({ ok: true });
    expect(startLearning(db, OWNER_ID, ids[1]!, t0)).toEqual({ ok: true });
    expect(startLearning(db, OWNER_ID, ids[2]!, t0)).toEqual({ ok: false, reason: "ladder_full" });
    const id = ids[0]!;
    const at = (min: number) => new Date(t0.getTime() + min * 60_000);
    applyAnswers(db, OWNER_ID, [answer(id, "learn", "right", at(1)), answer(id, "learn", "wrong", at(2)), answer(id, "learn", "right", at(3))]);
    expect(listGrammar(db, OWNER_ID, [id])[0]).toMatchObject({ status: "learning", learnStep: 1 });
    applyAnswers(db, OWNER_ID, [2, 3, 4].map((i) => answer(id, "learn", "soft", at(3 + i))));
    const up = listGrammar(db, OWNER_ID, [id])[0]!;
    expect(up).toMatchObject({ status: "checking", learnStep: LADDER_USE });
    expect(up.checkAt).toBe(new Date(at(7).getTime() + CHECK_AFTER).toISOString());
    // A wrong check sends it back to the last step.
    applyAnswers(db, OWNER_ID, [answer(id, "check", "wrong", at(200), "type")]);
    expect(listGrammar(db, OWNER_ID, [id])[0]).toMatchObject({ status: "learning", learnStep: LADDER_USE - 1 });
    applyAnswers(db, OWNER_ID, [answer(id, "learn", "right", at(201), "type"), answer(id, "check", "right", at(500), "type")]);
    const learned = listGrammar(db, OWNER_ID, [id])[0]!;
    expect(learned.status).toBe("learned");
    expect(new Date(learned.due!).getTime()).toBeGreaterThan(at(500).getTime());
    // A review moves the schedule; practice off the schedule doesn't.
    applyAnswers(db, OWNER_ID, [answer(id, "extra", "wrong", at(600))]);
    expect(listGrammar(db, OWNER_ID, [id])[0]!.reps).toBe(1);
    applyAnswers(db, OWNER_ID, [answer(id, "review", "right", new Date(learned.due!))]);
    expect(listGrammar(db, OWNER_ID, [id])[0]!.reps).toBe(2);
  });

  it("counts a resent answer once", () => {
    const db = openDb(":memory:");
    const id = addGrammar(db, OWNER_ID, [mustPoint]).created[0]!.id;
    startLearning(db, OWNER_ID, id);
    const a = answer(id, "learn", "right", new Date());
    expect(applyAnswers(db, OWNER_ID, [a])).toEqual({ applied: 1 });
    expect(applyAnswers(db, OWNER_ID, [a])).toEqual({ applied: 0 });
    expect(listGrammar(db, OWNER_ID, [id])[0]!.learnStep).toBe(1);
  });
});

describe("stats", () => {
  it("counts first tries by task and by conjugation class", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-11-28T10:00:00Z");
    const id = addGrammar(db, OWNER_ID, [mustPoint], now).created[0]!.id;
    startLearning(db, OWNER_ID, id, now);
    applyAnswers(db, OWNER_ID, [
      { ...answer(id, "learn", "wrong", now), cls: "d" },
      { ...answer(id, "learn", "right", now, "type"), cls: "d" },
      { ...answer(id, "fix", "right", now), cls: "d" },
    ]);
    const stats = grammarStats(db, OWNER_ID, now);
    expect(stats).toMatchObject({ total: 1, learning: 1, pool: 0, learned: 0 });
    expect(stats.classes).toEqual([{ cls: "d", answers: 2, right: 1 }]);
    expect(stats.tasks.sort((a, b) => a.task.localeCompare(b.task))).toEqual([
      { task: "choose", answers: 1, right: 0 },
      { task: "type", answers: 1, right: 1 },
    ]);
    expect(stats.missed).toEqual([{ id, pattern: "-아/어야 하다", meaning: "надо, должен", wrong: 1, answers: 2 }]);
    expect(stats.learnedDays).toHaveLength(16);
  });
});

describe("routes", () => {
  it("lists, starts and answers over HTTP, for the signed-in user only", async () => {
    const t = testApp();
    expect((await t.request("/grammar")).status).toBe(401);
    expect((await t.request("/grammar/stats")).status).toBe(401);
    await t.signIn();
    const id = addGrammar(t.db, OWNER_ID, [mustPoint]).created[0]!.id;
    const list = await t.request("/grammar");
    expect(list.status, list.text).toBe(200);
    expect(list.json.points).toHaveLength(1);
    expect((await t.request(`/grammar/${id}/learning`, { body: {} })).json.point.status).toBe("learning");
    const res = await t.request("/grammar/answers", { body: { answers: [{ ...answer(id, "learn", "right", t.clock.now), answeredAt: t.clock.now.toISOString() }] } });
    expect(res.json).toMatchObject({ applied: 1, points: [{ id, learnStep: 1 }] });
    expect((await t.request("/grammar/stats")).json.learning).toBe(1);
    expect((await t.request("/grammar/answers", { body: { answers: [] } })).status).toBe(400);
  });
});
