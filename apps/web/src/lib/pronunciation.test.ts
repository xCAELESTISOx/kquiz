import { describe, expect, it } from "vitest";
import { describeErrors, segments, verdict } from "./pronunciation";
import type { ScoreResult } from "./types";

const result: ScoreResult = {
  attemptId: 1,
  cardId: 1,
  score: 70,
  pronunciation: "궁물",
  syllables: [
    { text: "국", pron: "궁", status: "wrong" },
    { text: "물", pron: "물", status: "weak" },
  ],
  errors: [
    { syllable: 1, position: "vowel", kind: "unclear", status: "weak", expected: { ipa: "u", jamo: "ㅜ" }, heard: { ipa: "u", jamo: "ㅜ" } },
    { syllable: 0, position: "coda", kind: "substitution", status: "wrong", expected: { ipa: "ŋ", jamo: "ㅇ" }, heard: { ipa: "k", jamo: "ㄱ" } },
  ],
  suggestedRating: "hard",
};

describe("pronunciation", () => {
  it("keeps spaces and punctuation between scored syllables", () => {
    const three = [
      { text: "안", pron: "안", status: "ok" as const },
      { text: "녕", pron: "녕", status: "wrong" as const },
      { text: "요", pron: "요", status: "ok" as const },
    ];
    expect(segments("안녕, 요!", three)).toEqual([
      { text: "안", status: "ok", index: 0 },
      { text: "녕", status: "wrong", index: 1 },
      { text: "," },
      { text: " " },
      { text: "요", status: "ok", index: 2 },
      { text: "!" },
    ]);
    expect(segments("다른 말", result.syllables).map((s) => s.text)).toEqual(["국", "물"]);
  });

  it("lists wrong sounds first in plain words", () => {
    expect(describeErrors(result)).toEqual([
      {
        syllable: "국",
        status: "wrong",
        label: "Batchim", detail: "expected ㅇ [ŋ], heard ㄱ [k]",
        fix: "This sound is nasal: before ㄴ and ㅁ, ㄱ is read as ㅇ. Don't cut it off, let the air out through your nose.",
      },
      { syllable: "물", status: "weak", label: "Vowel", detail: "ㅜ [u] sounds unsure" },
    ]);
  });

  it("never calls weak syllables a mistake", () => {
    expect(verdict({ ...result, suggestedRating: "good" }).tone).toBe("ok");
    expect(verdict(result).title).toBe("Almost");
  });
});
