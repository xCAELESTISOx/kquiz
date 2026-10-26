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
