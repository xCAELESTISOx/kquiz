import { expect, it } from "vitest";
import { bank, buildRating, checkBuild, fallbackTiles, looksLikePhrase, trailingPunctuation } from "./phrase";
import type { Card } from "./types";

it("checks each slot of a built phrase", () => {
  expect(checkBuild(["화장실이", "어디예요"], ["화장실이", "어디예요"])).toEqual(["right", "right"]);
  expect(checkBuild(["화장실이", "어디예요"], ["화장실을", "어디예요"])).toEqual(["wrong", "right"]);
  expect(checkBuild(["잘", "먹겠습니다"], ["잘"])).toEqual(["right", "wrong"]);
});

it("grades a build: wrong is again, slow is hard", () => {
  expect(buildRating(false, 1000, 2)).toBe("again");
  expect(buildRating(true, 4000, 2)).toBe("good");
  expect(buildRating(true, 20_000, 2)).toBe("hard");
});

it("keeps equal blocks as separate tiles", () => {
  const tiles = bank({ blocks: ["네", "네"], decoys: ["아니요"] }, () => 0);
  expect(tiles.map((t) => t.id)).toEqual([0, 1, 2]);
  expect(tiles.map((t) => t.text).sort()).toEqual(["네", "네", "아니요"]);
});

it("falls back to the phrase's words and puts its punctuation back", () => {
  expect(fallbackTiles({ korean: "어떻게 지내요?" } as Card)).toEqual({ blocks: ["어떻게", "지내요"], decoys: [] });
  expect(trailingPunctuation("어떻게 지내요?")).toBe("?");
  expect(trailingPunctuation("잘 먹겠습니다")).toBe("");
});

it("guesses a phrase in the add form", () => {
  expect(looksLikePhrase("안녕히 가세요")).toBe(true);
  expect(looksLikePhrase("감사합니다.")).toBe(true);
  expect(looksLikePhrase("바다")).toBe(false);
});
