import { describe, expect, it } from "vitest";
import { arranged, choiceRating, shuffled, slotDealer } from "./choice";

describe("choice", () => {
  it("rates the pick", () => {
    expect(choiceRating(false, 1000)).toBe("again");
    expect(choiceRating(true, 3000)).toBe("good");
    expect(choiceRating(true, 6_000)).toBe("good");
    expect(choiceRating(true, 8_000)).toBe("hard");
  });

  it("shuffles without losing or changing the input", () => {
    const input = [1, 2, 3, 4];
    const out = shuffled(input, () => 0);
    expect(out).toEqual([2, 3, 4, 1]);
    expect(input).toEqual([1, 2, 3, 4]);
  });

  it("puts the right answer in every place once per bag, never twice running", () => {
    const deal = slotDealer();
    const slots = Array.from({ length: 400 }, () => deal(4));
    for (let i = 0; i < slots.length; i += 4) expect(new Set(slots.slice(i, i + 4)).size).toBe(4);
    for (let i = 1; i < slots.length; i++) expect(slots[i]).not.toBe(slots[i - 1]);
  });

  it("keeps every option when arranging", () => {
    const out = arranged("right", ["a", "b", "c"], Math.random, () => 2);
    expect(out[2]).toBe("right");
    expect([...out].sort()).toEqual(["a", "b", "c", "right"]);
    expect(arranged("only", [])).toEqual(["only"]);
  });
});
