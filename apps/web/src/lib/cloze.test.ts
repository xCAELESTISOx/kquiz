import { describe, expect, it } from "vitest";
import { clozeFor, findWord } from "./cloze";
import type { Card } from "./types";

const span = (word: string, sentence: string) => {
  const found = findWord(word, sentence);
  return found && sentence.slice(found.start, found.end);
};

describe("findWord", () => {
  it("finds inflected verbs by their stem", () => {
    expect(span("먹다", "저는 밥을 먹어요.")).toBe("먹어요");
    expect(span("공부하다", "도서관에서 공부했어요")).toBe("공부했어요");
    expect(span("가다", "학교에 가요")).toBe("가요");
  });

  it("marks a noun without its particle", () => {
    expect(span("바다", "바다에 가고 싶어요")).toBe("바다");
    expect(span("물", "물을 주세요")).toBe("물");
  });

  it("matches only at the start of a word", () => {
    expect(span("가다", "제가 했어요")).toBeUndefined();
    expect(span("예쁘다", "예, 알겠습니다")).toBeUndefined();
  });

  it("gives up on irregular stems", () => {
    expect(span("듣다", "음악을 들어요")).toBeUndefined();
  });
});

describe("clozeFor", () => {
  const card = {
    korean: "먹다",
    examples: [
      { ko: "빵을 먹어요", ru: "Ем хлеб" },
      { ko: "같이 먹을까요?", ru: "Поедим вместе?" },
      { ko: "배불러요", ru: "Я сыт" },
    ],
  } as Card;

  it("leaves new cards and every other review alone", () => {
    expect(clozeFor({ card, state: 1, reps: 2 })).toBeUndefined();
    expect(clozeFor({ card, state: 2, reps: 3 })).toBeUndefined();
  });

  it("cycles through examples and skips ones without the word", () => {
    expect(clozeFor({ card, state: 2, reps: 2 })).toEqual({ example: 1, before: "같이 ", word: "먹을까요", after: "?" });
    // reps 4 would pick the third example, which has no 먹-.
    expect(clozeFor({ card, state: 2, reps: 4 })).toEqual({ example: 0, before: "빵을 ", word: "먹어요", after: "" });
  });
});
