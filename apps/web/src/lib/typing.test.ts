import { describe, expect, it } from "vitest";
import { checkTyped, letters, typingRating, wrongKeyboard } from "./typing";

describe("letters", () => {
  it("splits a syllable", () => {
    expect(letters("국")).toEqual(["ㄱ", "ㅜ", "ㄱ"]);
    expect(letters("하")).toEqual(["ㅎ", "ㅏ", ""]);
    expect(letters("a")).toBeUndefined();
  });
});

describe("checkTyped", () => {
  it("ignores spaces and punctuation", () => {
    expect(checkTyped("안녕하세요", "안녕 하세요!").correct).toBe(true);
  });

  it("names a wrong vowel and calls one letter a slip", () => {
    const check = checkTyped("고기", "거기");
    expect(check).toMatchObject({ correct: false, almost: true, slips: ["ㅓ вместо ㅗ"] });
    expect(check.marks.map((m) => m.status)).toEqual(["wrong", "ok"]);
    expect(typingRating(check)).toBe("hard");
  });

  it("names a missing final", () => {
    expect(checkTyped("국물", "구물").slips).toEqual(["нет 받침 ㄱ в 국"]);
  });

  it("tells missing and extra syllables", () => {
    expect(checkTyped("학교", "학").marks.map((m) => m.status)).toEqual(["ok", "missing"]);
    const extra = checkTyped("물", "물요");
    expect(extra.slips).toEqual(["лишний слог 요"]);
    expect(typingRating(extra)).toBe("again");
  });

  it("is again for a different word", () => {
    expect(typingRating(checkTyped("사랑", "학교"))).toBe("again");
    expect(typingRating(checkTyped("사랑", ""))).toBe("again");
  });
});

it("notices a Latin keyboard", () => {
  expect(wrongKeyboard("dkssud")).toBe(true);
  expect(wrongKeyboard("안녕")).toBe(false);
});
