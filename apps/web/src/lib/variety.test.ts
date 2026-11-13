import { expect, it } from "vitest";
import { learnTask } from "./session";
import { learnKind, placeAfter, vary, type TaskKind } from "./variety";
import type { Card, QueueItem, ReviewMode } from "./types";

const card = (id: number) => ({ id, korean: `단어${id}`, meaning: `слово ${id}` }) as Card;
const review = (id: number, mode: ReviewMode = "speech"): QueueItem => ({ card: card(id), mode, due: "", state: 2, reps: 3, lapses: 0 });

it("keeps tasks of one kind apart and new words' steps where they are", () => {
  const check = learnTask(card(100), "check", true);
  const ways = new Map<QueueItem, TaskKind>();
  const reviews = [1, 2, 3, 4, 5, 6].map((id) => review(id, id > 3 ? "meaning" : "speech"));
  reviews.slice(0, 3).forEach((r) => ways.set(r, "write"));
  reviews.slice(3).forEach((r) => ways.set(r, "meaning"));
  const out = vary([check, ...reviews], (i) => learnKind(i) ?? ways.get(i));
  expect(out[0]).toBe(check);
  const kinds = out.map((i) => learnKind(i) ?? ways.get(i));
  expect(kinds).toEqual(["write", "meaning", "write", "meaning", "write", "meaning", "write"]);
  expect(new Set(out).size).toBe(7);
});

it("doesn't bring the same word back right away for the sake of variety", () => {
  const a = review(1, "speech");
  const b = review(1, "meaning");
  const c = review(2, "speech");
  const kinds = new Map<QueueItem, TaskKind>([[a, "write"], [b, "meaning"], [c, "write"]]);
  const out = vary([a, b, c], (i) => kinds.get(i));
  expect(out.map((i) => i.card.id)).toEqual([1, 2, 1]);
});

it("puts a step back a card nearer or further rather than next to its own kind", () => {
  const kinds = new Map<QueueItem, TaskKind>();
  const queue = [1, 2, 3, 4, 5, 6].map((id) => review(id));
  ["meaning", "meaning", "meaning", "write", "meaning", "meaning"].forEach((k, n) => kinds.set(queue[n]!, k as TaskKind));
  const step = learnTask(card(9), 2, true);
  // Four cards on would be next to the written 4th; one further keeps them apart.
  expect(placeAfter(queue, step, (i) => learnKind(i) ?? kinds.get(i), 3)).toBe(5);
});
