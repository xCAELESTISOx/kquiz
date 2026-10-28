import { describe, expect, it } from "vitest";
import { guessHints, isFirstShow, splitAt } from "./guess";
import type { Family, QueueItem } from "./types";

const word = (id: number, korean: string, meaning: string, known: boolean) => ({ id, korean, meaning, known });

describe("guessHints", () => {
  it("takes only well-learned words that share a meaningful root", () => {
    const families: Family[] = [
      { ko: "학", hanja: "學", meaning: "учёба", total: 3, cards: [word(1, "학교", "школа", true), word(2, "대학", "университет", true), word(3, "수학", "математика", true)] },
      { ko: "생", hanja: "生", meaning: "жизнь", total: 1, cards: [word(4, "생일", "день рождения", false)] },
    ];
    expect(guessHints(families)).toEqual([
      { syllable: "학", words: [{ id: 1, korean: "학교", meaning: "школа" }, { id: 2, korean: "대학", meaning: "университет" }] },
    ]);
  });

  it("gives nothing when the only known part is a grammatical one", () => {
    const families: Family[] = [
      { ko: "불", hanja: "不", meaning: "не", total: 1, cards: [word(1, "불가능", "невозможный", true)] },
      { ko: "편", hanja: "便", meaning: "удобство", total: 0, cards: [] },
    ];
    expect(guessHints(families)).toEqual([]);
  });
});

describe("isFirstShow", () => {
  const item = (mode: QueueItem["mode"], reps: number) => ({ mode, reps }) as QueueItem;
  it("is a meaning review never done before", () => {
    expect(isFirstShow(item("meaning", 0))).toBe(true);
    expect(isFirstShow(item("meaning", 1))).toBe(false);
    expect(isFirstShow(item("listening", 0))).toBe(false);
  });
});

describe("splitAt", () => {
  it("marks the shared syllable", () => {
    expect(splitAt("대학교", "학")).toEqual(["대", "학", "교"]);
    expect(splitAt("학교", "생")).toEqual(["학교", "", ""]);
  });
});
