import { describe, expect, it } from "vitest";
import { fixHint } from "./fixes";
import type { ScoreResult } from "./types";

type E = ScoreResult["errors"][number];
const jamo = (j: string) => ({ ipa: j, jamo: j });
const err = (position: E["position"], kind: E["kind"], expected?: string, heard?: string): E => ({
  syllable: 0,
  position,
  kind,
  status: "wrong",
  expected: expected ? jamo(expected) : null,
  heard: heard ? jamo(heard) : null,
});

describe("fixHint", () => {
  it("explains the three-way stop contrast with the right Russian letter", () => {
    expect(fixHint(err("onset", "substitution", "ㅋ", "ㄱ"))).toMatch(/Сильнее выдох: ㅋ как «к»/);
    expect(fixHint(err("onset", "substitution", "ㅌ", "ㄷ"))).toMatch(/ㅌ как «т»/);
    expect(fixHint(err("onset", "substitution", "ㄲ", "ㅋ"))).toMatch(/^Без выдоха: ㄲ/);
    expect(fixHint(err("onset", "substitution", "ㅆ", "ㅅ"))).toMatch(/русское «с»/);
    expect(fixHint(err("onset", "substitution", "ㄱ", "ㅋ"))).toMatch(/ㄱ расслабленный.*у ㅋ/);
  });

  it("covers vowels Russian merges", () => {
    expect(fixHint(err("vowel", "substitution", "ㅓ", "ㅗ"))).toMatch(/^Губы не округляй/);
    expect(fixHint(err("vowel", "substitution", "ㅡ", "ㅜ"))).toMatch(/растяни/);
    // No pair for this one: falls back to how the expected vowel is made.
    expect(fixHint(err("vowel", "substitution", "ㅠ", "ㅏ"))).toMatch(/^ㅠ = /);
  });

  it("keeps finals held and unreleased", () => {
    expect(fixHint(err("coda", "substitution", "ㄱ", "ㅋ"))).toMatch(/^ㄱ в конце.*без выдоха/);
    expect(fixHint(err("coda", "deletion", "ㅂ"))).toMatch(/^Не глотай конец слога/);
    expect(fixHint(err("coda", "substitution", "ㅇ", "ㄴ"))).toMatch(/sing/);
  });

  it("catches the extra vowel after a consonant", () => {
    expect(fixHint(err("extra", "insertion", undefined, "ㅡ"))).toMatch(/Не добавляй гласную/);
  });

  it("says nothing when the sound is unknown", () => {
    expect(fixHint(err("onset", "substitution", "?", "ㄱ"))).toBeUndefined();
    expect(fixHint(err("extra", "insertion", undefined, "?"))).toBeUndefined();
  });
});
