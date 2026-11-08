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
  it("explains the three-way stop contrast with the right English sound", () => {
    expect(fixHint(err("onset", "substitution", "ㅋ", "ㄱ"))).toMatch(/^Breathe out harder: ㅋ is like the k in “kite”/);
    expect(fixHint(err("onset", "substitution", "ㅌ", "ㄷ"))).toMatch(/ㅌ is like the t in “top”/);
    expect(fixHint(err("onset", "substitution", "ㄲ", "ㅋ"))).toMatch(/^No breath: ㄲ/);
    expect(fixHint(err("onset", "substitution", "ㅆ", "ㅅ"))).toMatch(/ㅆ is close to the s in “see”/);
    expect(fixHint(err("onset", "substitution", "ㄱ", "ㅋ"))).toMatch(/ㄱ is relaxed.*puff of ㅋ/);
  });

  it("covers vowels English speakers mix up", () => {
    expect(fixHint(err("vowel", "substitution", "ㅓ", "ㅗ"))).toMatch(/^Don't round your lips/);
    expect(fixHint(err("vowel", "substitution", "ㅡ", "ㅜ"))).toMatch(/spread/);
    // No pair for this one: falls back to how the expected vowel is made.
    expect(fixHint(err("vowel", "substitution", "ㅠ", "ㅏ"))).toMatch(/^ㅠ = /);
  });

  it("keeps finals held and unreleased", () => {
    expect(fixHint(err("coda", "substitution", "ㄱ", "ㅋ"))).toMatch(/^Final ㄱ.*no breath/);
    expect(fixHint(err("coda", "deletion", "ㅂ"))).toMatch(/^Don't swallow the end of the syllable/);
    expect(fixHint(err("coda", "substitution", "ㅇ", "ㄴ"))).toMatch(/sing/);
  });

  it("catches the extra vowel after a consonant", () => {
    expect(fixHint(err("extra", "insertion", undefined, "ㅡ"))).toMatch(/Don't add a vowel/);
  });

  it("says nothing when the sound is unknown", () => {
    expect(fixHint(err("onset", "substitution", "?", "ㄱ"))).toBeUndefined();
    expect(fixHint(err("extra", "insertion", undefined, "?"))).toBeUndefined();
  });
});
