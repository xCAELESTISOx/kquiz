import { describe, expect, it } from "vitest";
import { afterIntro, buildable, firstTasks, insertAfter, insertNext, interleave, learnTask } from "./session";
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
  const opts = [{ id: 2, korean: "단어2", meaning: "слово 2" }];
  const kinds = (c: Card, o = opts, say = true) => afterIntro(c, o, { hear: true, say }).map((i) => i.learn?.kind);

  it("picks the Korean, builds it, says it, in that order", () => {
    expect(kinds(card(1))).toEqual(["choose", "build", "aloud"]);
    expect(afterIntro(card(1), opts, { hear: true, say: true })[0]!.mode).toBe("speech");
  });

  it("leaves out what doesn't fit the word or the phone", () => {
    expect(kinds(card(1), [])).toEqual(["build", "aloud"]);
    expect(kinds(card(1), opts, false)).toEqual(["choose", "build"]);
    // One syllable: nothing to build.
    expect(kinds({ ...card(1), korean: "눈" })).toEqual(["choose", "aloud"]);
    expect(buildable({ ...card(1), korean: "눈" })).toBe(false);
    // A phrase is built, not said.
    expect(kinds({ ...card(1), kind: "phrase" })).toEqual(["choose", "build"]);
  });
});

describe("typing right after", () => {
  it("comes after the word's own tasks ahead, or next after the card on screen", () => {
    const w = card(1);
    const [choose, , aloud] = afterIntro(w, [{ id: 2, korean: "x", meaning: "y" }], { hear: true, say: true });
    const typed = learnTask(w, 1, true);
    expect(insertNext([choose!, aloud!, review(5)], typed).map((i) => i.learn?.kind ?? "review")).toEqual(["choose", "aloud", "dictation", "review"]);
    expect(insertNext([aloud!, review(5)], typed).map((i) => i.learn?.kind ?? "review")).toEqual(["aloud", "dictation", "review"]);
    expect(insertNext([review(4), review(5)], typed).map((i) => i.card.id)).toEqual([4, 1, 5]);
    // A pick put back further on is not waited for.
    expect(insertNext([aloud!, review(5), choose!], typed).map((i) => i.learn?.kind ?? "review")).toEqual(["aloud", "dictation", "review", "choose"]);
  });
});
