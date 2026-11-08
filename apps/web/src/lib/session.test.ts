import { describe, expect, it } from "vitest";
import { afterFix, afterIntro, buildable, firstTasks, insertAfter, interleave, learnTask, withMistake } from "./session";
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
