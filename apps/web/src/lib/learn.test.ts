import { describe, expect, it } from "vitest";
import { buildTiles, learnSteps, reinforceSteps, requeue } from "./learn";
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
