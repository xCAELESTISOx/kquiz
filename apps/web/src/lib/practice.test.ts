import { describe, expect, it } from "vitest";
import { buildRound, type Drill } from "./practice";

const drill = (id: number, ready = true): Drill => ({
  id,
  contrast: "ㄱ/ㅋ",
  words: [
    { korean: `가${id}`, meaning: null },
    { korean: `카${id}`, meaning: null },
  ],
  correct: 0,
  wrong: 0,
  ready,
  voices: ["M1"],
});

describe("buildRound", () => {
  it("draws from the hardest ready drills and never repeats a set back to back", () => {
    const drills = [drill(1), drill(2, false), ...[3, 4, 5, 6, 7, 8, 9].map((id) => drill(id))];
    const round = buildRound(drills);
    expect(round).toHaveLength(12);
    const used = new Set(round.map((t) => t.drill.id));
    expect(used.has(2)).toBe(false);
    expect(used.has(9)).toBe(false);
    for (let i = 1; i < round.length; i++) expect(round[i]!.drill.id).not.toBe(round[i - 1]!.drill.id);
    for (const t of round) expect(t.target).toBeLessThan(t.drill.words.length);
    for (const t of round) expect([undefined, "M1"]).toContain(t.voice);
  });

  it("is empty with nothing playable", () => {
    expect(buildRound([drill(1, false)])).toEqual([]);
  });
});
