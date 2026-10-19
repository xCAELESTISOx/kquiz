import { describe, expect, it } from "vitest";
import { isKoreanOnly, parseBulk } from "./korean";

describe("parseBulk", () => {
  it("parses lines with different separators", () => {
    const lines = parseBulk("물 — вода\n불 - огонь\n하늘\tнебо\n바다 – море\n\n");
    expect(lines.map((l) => [l.card?.korean, l.card?.meaning])).toEqual([
      ["물", "вода"],
      ["불", "огонь"],
      ["하늘", "небо"],
      ["바다", "море"],
    ]);
  });

  it("keeps hyphens inside words", () => {
    const [line] = parseBulk("잘 지내다 — жить-поживать");
    expect(line?.card).toEqual({ korean: "잘 지내다", meaning: "жить-поживать" });
  });

  it("flips swapped sides", () => {
    const [line] = parseBulk("вода — 물");
    expect(line?.card).toEqual({ korean: "물", meaning: "вода" });
  });

  it("reports bad lines with their line numbers", () => {
    const lines = parseBulk("물 — вода\nбез разделителя\ncat — кошка");
    expect(lines.filter((l) => l.error).map((l) => [l.line, l.error])).toEqual([
      [2, "Нет разделителя «—»"],
      [3, "Нет корейского слова"],
    ]);
  });
});

describe("isKoreanOnly", () => {
  it("accepts Hangul with punctuation only", () => {
    expect(isKoreanOnly("감사합니다!")).toBe(true);
    expect(isKoreanOnly("감사합니다 (вежливо)")).toBe(false);
  });
});
