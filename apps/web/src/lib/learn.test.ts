import { describe, expect, it } from "vitest";
import { buildTiles, groupReinforce, groupSteps, learnSteps, reinforceSteps, requeue } from "./learn";
import type { Card } from "./types";

const card = {
  id: 7,
  korean: "먹다",
  meaning: "есть",
  examples: [
    { ko: "밥을 먹어요.", ru: "Ем рис." },
    { ko: "뭐 먹었어요?", ru: "Что ты ел?" },
  ],
} as Card;

describe("learnSteps", () => {
  it("goes from meeting the word to saying it", () => {
    const steps = learnSteps(card, { hear: true, say: true });
    expect(steps.map((s) => s.kind)).toEqual(["intro", "build", "dictation", "write", "cloze", "aloud"]);
    expect(steps.find((s) => s.kind === "cloze")?.cloze?.word).toBe("먹어요");
  });

  it("leaves out what can't be done", () => {
    const noExamples = { ...card, examples: [] };
    expect(learnSteps(noExamples, { hear: false, say: false }).map((s) => s.kind)).toEqual(["intro", "build", "write"]);
  });

  it("reinforces through another example", () => {
    const steps = reinforceSteps(card, { hear: true, say: true }, 1);
    expect(steps.map((s) => s.kind).sort()).toEqual(["cloze", "dictation", "write"]);
    expect(steps.find((s) => s.kind === "cloze")?.cloze?.word).toBe("먹었어요");
  });
});

it("brings a missed step back after the next one", () => {
  expect(requeue([2, 3, 4], 1)).toEqual([2, 1, 3, 4]);
  expect(requeue([], 1)).toEqual([1]);
});

it("mixes the word's syllables with decoys from look-alikes", () => {
  const tiles = buildTiles(card, [{ id: 2, korean: "먹이", meaning: "корм" }, { id: 3, korean: "막다", meaning: "закрывать" }]);
  expect(tiles.sort()).toEqual(["다", "막", "먹", "이"].sort());
});

describe("groupSteps", () => {
  const word = (id: number, korean: string) => ({ ...card, id, korean, kind: "word" }) as Card;
  const phrase = { id: 9, korean: "잘 먹겠습니다.", meaning: "приятного аппетита", kind: "phrase", examples: [] } as unknown as Card;
  const can = () => ({ hear: true, say: true });

  it("meets each word and builds it one word later, then goes round by round", () => {
    const steps = groupSteps([word(1, "먹다"), word(2, "마시다"), word(3, "자다")], can);
    expect(steps.slice(0, 6).map((s) => `${s.kind}${s.cardId}`)).toEqual(["intro1", "intro2", "build1", "intro3", "build2", "build3"]);
    const kinds = steps.slice(6).map((s) => s.kind);
    expect(kinds.lastIndexOf("dictation")).toBeLessThan(kinds.indexOf("write"));
    expect(kinds.lastIndexOf("write")).toBeLessThan(kinds.indexOf("aloud"));
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.cardId).not.toBe(steps[i - 1]!.cardId);
  });

  it("builds a phrase from its blocks, shown whole the first time", () => {
    const steps = groupSteps([word(1, "먹다"), phrase], can);
    const own = steps.filter((s) => s.cardId === 9);
    expect(own.map((s) => s.kind)).toEqual(["phrase", "phrase-ear", "phrase"]);
    expect(own[0]!.first).toBe(true);
    expect(own[2]!.first).toBeUndefined();
  });

  it("reinforces every word in one round", () => {
    const steps = groupReinforce([word(1, "먹다"), word(2, "마시다")], can, 1);
    // 마시다 isn't in the examples, so it has no sentence to fill in.
    expect(steps.map((s) => `${s.kind}${s.cardId}`).sort()).toEqual(["cloze1", "dictation1", "dictation2", "write1", "write2"]);
  });
});
