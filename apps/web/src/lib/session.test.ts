import { describe, expect, it } from "vitest";
import { afterFix, afterIntro, buildable, firstTasks, insertAfter, insertNext, interleave, learnTask, onward, toFront, unfinished, withMistake } from "./session";
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

  it("keeps each task missed once, and goes over them until each is right", () => {
    const pick: QueueItem = { ...review(5), learn: { kind: "choose" } };
    let mistakes = withMistake([], review(1));
    mistakes = withMistake(mistakes, pick);
    mistakes = withMistake(mistakes, { ...pick });
    mistakes = withMistake(mistakes, { ...review(5), learn: { kind: "intro" } });
    // The same word in another mode is another task.
    mistakes = withMistake(mistakes, { ...review(1), mode: "listening" });
    expect(mistakes.map((m) => [m.card.id, m.learn?.kind ?? m.mode])).toEqual([
      [1, "meaning"],
      [5, "choose"],
      [1, "listening"],
    ]);
    const again = afterFix(mistakes, false);
    expect(again[2]).toBe(mistakes[0]);
    expect(afterFix(again, true)).toEqual([mistakes[2], mistakes[0]]);
    expect(afterFix([mistakes[0]!], false)).toEqual([mistakes[0]]);
    expect(afterFix([], true)).toEqual([]);
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

describe("finishing words past the goal", () => {
  it("finds the next step of a word begun in this stretch, not new words or reviews", () => {
    const review = { card: card(9), mode: "meaning", due: "", state: 2, reps: 3, lapses: 0 } as QueueItem;
    const queue = [review, firstTasks([{ card: card(3), step: 0 }], true)[0]!, learnTask(card(4), 1, true), learnTask(card(1), 1, true)];
    expect(unfinished(queue, new Set([1, 3]))).toBe(3);
    expect(unfinished(queue, new Set([3]))).toBe(-1);
  });

  it("brings that step to the front", () => {
    expect(toFront(["a", "b", "c", "d"], 2)).toEqual(["c", "a", "b", "d"]);
    expect(toFront(["a", "b"], 0)).toEqual(["a", "b"]);
  });
});

describe("the card shown after an answer", () => {
  const listen = (id: number): QueueItem => ({ ...review(id), mode: "listening" });
  it("is the head before the goal", () => {
    const q = [listen(1), learnTask(card(2), 1, true)];
    expect(onward(q, 14, 15, new Set([2])).shown).toBe(q[0]);
  });
  it("past the goal is the step of a word begun, brought to the front, not a review", () => {
    const step = learnTask(card(2), 1, true);
    const r = onward([listen(1), step], 16, 15, new Set([2]));
    expect(r.shown).toBe(step);
    expect(r.queue[0]).toBe(step);
  });
  it("is nothing once the stretch ends", () => {
    expect(onward([listen(1)], 16, 15, new Set([2])).shown).toBeUndefined();
    expect(onward([learnTask(card(2), 1, true)], 20, 15, new Set([2])).shown).toBeUndefined();
  });
});
