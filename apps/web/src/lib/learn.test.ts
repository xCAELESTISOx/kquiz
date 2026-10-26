import { describe, expect, it } from "vitest";
import { clozeFor } from "./cloze";
import { learnRound } from "./learn";
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

describe("learnRound", () => {
  it("goes from reading the word to saying it", () => {
    const steps = learnRound(card, 1, { hear: true, say: true, pick: true });
    expect(steps.map((s) => [s.item.mode, !!s.pick])).toEqual([
      ["meaning", false],
      ["listening", false],
      ["speech", true],
      ["speech", false],
    ]);
  });

  it("leaves out what can't be done", () => {
    const steps = learnRound(card, 1, { hear: false, say: false, pick: true });
    expect(steps.map((s) => s.item.mode)).toEqual(["meaning", "speech"]);
    expect(learnRound(card, 1, { hear: false, say: false, pick: false })).toHaveLength(1);
  });

  it("asks through a different example every other round", () => {
    const words = [1, 2, 3, 4].map((round) => clozeFor(learnRound(card, round, { hear: false, say: false, pick: false })[0]!.item));
    expect(words[0]).toBeUndefined();
    expect(words[1]?.example).toBe(1);
    expect(words[2]).toBeUndefined();
    expect(words[3]?.example).toBe(0);
  });
});
