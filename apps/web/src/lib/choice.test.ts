import { describe, expect, it } from "vitest";
import { choiceRating, shuffled } from "./choice";

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
});
