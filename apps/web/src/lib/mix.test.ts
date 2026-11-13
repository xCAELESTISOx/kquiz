import { expect, it } from "vitest";
import { mixWays, serverModes } from "./mix";
import type { QueueItem, ReviewMode } from "./types";

const item = (mode: ReviewMode, id: number) => ({ mode, card: { id } }) as QueueItem;

it("gives each item one of the picked ways its schedule allows", () => {
  const items = [item("meaning", 1), item("speech", 2), item("speech", 3), item("listening", 4)];
  const ways = mixWays(items, new Set(["meaning", "choice", "write", "dictation"]), { record: false, pick: (i) => i.card.id === 2 }, () => 0.99);
  expect(items.map((i) => ways.get(i))).toEqual(["meaning", "write", "write", "dictation"]);
  const first = mixWays(items, new Set(["meaning", "choice", "write", "dictation"]), { record: false, pick: (i) => i.card.id === 2 }, () => 0);
  expect(first.get(items[1]!)).toBe("choice");
});

it("leaves out items nothing picked can ask", () => {
  const items = [item("speech", 1), item("listening", 2)];
  expect(mixWays(items, new Set(["aloud", "choice"]), { record: false, pick: () => false }).size).toBe(0);
});

it("maps typing onto the schedules it reviews", () => {
  expect(serverModes(new Set(["write", "dictation"]))).toEqual(["speech", "listening"]);
});

it("asks each item the way used least so far, counting the tasks the session has anyway", () => {
  const items = [1, 2, 3, 4, 5, 6].map((id) => item("speech", id));
  const ways = mixWays(items, new Set(["choice", "write", "aloud"]), { record: true, pick: () => true }, () => 0, ["write", "write"]);
  const counts = { aloud: 0, choice: 0, write: 0 } as Record<string, number>;
  for (const i of items) counts[ways.get(i)!]!++;
  // Two written already: the six go mostly to the other two.
  expect(counts).toEqual({ aloud: 3, choice: 3, write: 0 });
});
