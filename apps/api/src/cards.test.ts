import { describe, expect, it } from "vitest";
import { isKoreanOnly, isSpeakable, normalizeKorean, parseBulk } from "./cards.js";

describe("cards", () => {
  it("normalizes whitespace", () => {
    expect(normalizeKorean("  감사  합니다 ")).toBe("감사 합니다");
  });

  it("accepts only Hangul with punctuation", () => {
    expect(isKoreanOnly("감사합니다!")).toBe(true);
    expect(isKoreanOnly("감사합니다 (вежливо)")).toBe(false);
  });

  it("limits speakable cards to short phrases", () => {
    expect(isSpeakable("안녕하세요")).toBe(true);
    expect(isSpeakable("가".repeat(13))).toBe(false);
    expect(isSpeakable("hello")).toBe(false);
  });

  it("parses bulk lines with different separators", () => {
    const { cards, rejected } = parseBulk("물 — вода\n불 - огонь\n하늘\tнебо\nбез разделителя\n\n");
    expect(cards.map((c) => [c.korean, c.meaning])).toEqual([
      ["물", "вода"],
      ["불", "огонь"],
      ["하늘", "небо"],
    ]);
    expect(rejected).toEqual(["без разделителя"]);
  });
});
