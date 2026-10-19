import { describe, expect, it } from "vitest";
import { applyRating, newReviewState, suggestRating } from "./review.js";

describe("review", () => {
  it("schedules a good answer later than an again", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    const state = newReviewState(now);
    const again = applyRating(state, "again", now);
    const good = applyRating(state, "good", now);
    expect(good.due.getTime()).toBeGreaterThanOrEqual(again.due.getTime());
    expect(good.reps).toBe(1);
  });

  it("maps scores to suggested ratings", () => {
    expect(suggestRating(30)).toBe("again");
    expect(suggestRating(60)).toBe("hard");
    expect(suggestRating(85)).toBe("good");
    expect(suggestRating(97)).toBe("easy");
  });
});
