import { describe, expect, it } from "vitest";
import { applyRating, newReviewState, suggestSpeechRating } from "./review.js";

describe("review", () => {
  it("schedules a good answer later than an again", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    const state = newReviewState(now);
    const again = applyRating(state, "again", now);
    const good = applyRating(state, "good", now);
    expect(good.due.getTime()).toBeGreaterThanOrEqual(again.due.getTime());
    expect(good.reps).toBe(1);
  });

  it("suggests speech ratings without punishing weak syllables", () => {
    expect(suggestSpeechRating(96, ["ok", "ok"])).toBe("easy");
    expect(suggestSpeechRating(88, ["ok", "weak"])).toBe("good");
    expect(suggestSpeechRating(70, ["ok", "wrong", "ok"])).toBe("hard");
    expect(suggestSpeechRating(40, ["wrong", "wrong", "ok"])).toBe("again");
    expect(suggestSpeechRating(40, ["wrong"])).toBe("again");
  });
});
