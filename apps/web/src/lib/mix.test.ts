import { expect, it } from "vitest";
import { mixWays, serverModes, weakWays } from "./mix";
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

it("asks a word more often the way it goes worst for it, and never drops a way", () => {
  const all = ["aloud", "choice", "write"] as const;
  // Speaks it well, picks it well, writes it badly.
  const skills = { speak: { answers: 6, missed: 0 }, choose: { answers: 5, missed: 0 }, write: { answers: 4, missed: 3 } };
  const w = weakWays(all, skills)!;
  expect(w.get("write")!).toBeGreaterThan(w.get("aloud")! * 5);
  expect(w.get("aloud")!).toBeGreaterThan(0);

  // With the weights, a thousand sessions ask it in writing most of the time, the other ways still now and then.
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const counts = { aloud: 0, choice: 0, write: 0 } as Record<string, number>;
  for (let n = 0; n < 1000; n++) {
    const word = item("speech", 1);
    counts[mixWays([word], new Set(all), { record: true, pick: () => true }, random, [], () => skills).get(word)!]!++;
  }
  expect(counts.write).toBeGreaterThan(700);
  expect(counts.aloud).toBeGreaterThan(20);
  expect(counts.choice).toBeGreaterThan(20);
});

it("asks a word as any other until it has a few answers in its ways", () => {
  expect(weakWays(["listening", "dictation"], { dictation: { answers: 2, missed: 2 } })).toBeUndefined();
  expect(weakWays(["listening", "dictation"], { write: { answers: 9, missed: 9 } })).toBeUndefined();
  expect(weakWays(["meaning"], { recall: { answers: 9, missed: 9 } })).toBeUndefined();
  // A way never tried counts as an average one, not as a strong one.
  const w = weakWays(["listening", "dictation"], { listen: { answers: 6, missed: 0 } })!;
  expect(w.get("dictation")!).toBeGreaterThan(w.get("listening")!);
});
