import { describe, expect, it } from "vitest";
import { afterIntro, firstTasks, insertAfter, interleave, learnTask, pickMeanings } from "./session";
import type { Card, QueueItem } from "./types";

const card = (id: number) => ({ id, korean: `단어${id}`, meaning: `слово ${id}` }) as Card;
const review = (id: number): QueueItem => ({ card: card(id), mode: "meaning", due: "", state: 2, reps: 3, lapses: 0 });

describe("session", () => {
  it("meets a word first, then climbs its ladder, and checks it from the translation", () => {
    const [a, b, c] = firstTasks(
      [
        { card: card(1), step: 0 },
        { card: card(2), step: 1 },
        { card: card(3), step: "check" },
      ],
      true,
    );
    expect(a!.learn).toEqual({ kind: "intro" });
    expect(b!.learn).toEqual({ kind: "dictation" });
    expect(b!.mode).toBe("listening");
    expect(c!.learn).toEqual({ kind: "write", check: true });
    expect(learnTask(card(1), 0, true).learn?.kind).toBe("build");
    expect(learnTask(card(1), 2, true).learn?.kind).toBe("write");
    // Without sound the ear step is written instead.
    expect(learnTask(card(1), 1, false).learn?.kind).toBe("write");
  });

  it("spreads new words through the reviews and puts a step back a few cards later", () => {
    const learning = [introTaskOf(10), introTaskOf(11)];
    const mixed = interleave([review(1), review(2), review(3)], learning);
    expect(mixed.map((i) => i.card.id)).toEqual([10, 1, 2, 11, 3]);
    expect(interleave([], learning).map((i) => i.card.id)).toEqual([10, 11]);
    expect(insertAfter(mixed, review(9)).map((i) => i.card.id)).toEqual([10, 1, 2, 11, 9, 3]);
    expect(insertAfter([review(1)], review(9)).map((i) => i.card.id)).toEqual([1, 9]);
  });
});

function introTaskOf(id: number): QueueItem {
  return firstTasks([{ card: card(id), step: 0 }], true)[0]!;
}

describe("right after meeting a word", () => {
  const opts = [
    { id: 2, korean: "단어2", meaning: "слово 2" },
    { id: 3, korean: "단어3", meaning: "Слово 1" },
    { id: 4, korean: "단어4", meaning: "слово 4" },
  ];

  it("picks its meaning, then builds it, before anything else", () => {
    expect(afterIntro(card(1), opts, true).map((i) => i.learn?.kind)).toEqual(["pick", "build"]);
    // Nothing to pick from, or a phrase: straight to building.
    expect(afterIntro(card(1), [], true).map((i) => i.learn?.kind)).toEqual(["build"]);
    expect(afterIntro({ ...card(1), kind: "phrase" }, opts, true).map((i) => i.learn?.kind)).toEqual(["build"]);
  });

  it("offers the word's own meaning among different ones", () => {
    const m = pickMeanings(card(1), opts);
    expect(m).toHaveLength(3);
    expect(m).toContain("слово 1");
    expect(m).not.toContain("Слово 1");
  });
});
