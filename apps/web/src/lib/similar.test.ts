import { describe, expect, it } from "vitest";
import { afterNudge, similarAnswer } from "./similar";
import type { Card } from "./types";

const card = {
  id: 1,
  korean: "휴지통",
  meaning: "корзина для бумаг",
  similar: [{ id: 2, korean: "쓰레기통", meaning: "мусорное ведро", note: null }],
} as Card;

describe("similar words", () => {
  it("spots the linked word, spacing and punctuation aside", () => {
    expect(similarAnswer(card, " 쓰레기 통!")?.id).toBe(2);
    expect(similarAnswer(card, "휴지통")).toBeUndefined();
    expect(similarAnswer(card, "물")).toBeUndefined();
    expect(similarAnswer(card, "")).toBeUndefined();
    expect(similarAnswer({ ...card, similar: undefined }, "쓰레기통")).toBeUndefined();
  });

  it("lowers a clean answer after a nudge, and leaves a miss alone", () => {
    expect(afterNudge("good", true)).toBe("hard");
    expect(afterNudge("good", false)).toBe("good");
    expect(afterNudge("again", true)).toBe("again");
  });
});
