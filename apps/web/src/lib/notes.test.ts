import { describe, expect, it } from "vitest";
import { cardNotes, koreanRuns, noteAbout, parseNotes } from "./notes";

describe("parseNotes", () => {
  it("puts marked lines into groups and keeps the rest as remarks", () => {
    const parsed = parseNotes(
      ["Просто «ниже», пара к 위.", "≠ 밑 — прямо под, вплотную", "↔ 위 — верх", "+ 아래층 — нижний этаж", "+ 아래요: «ниже» (на кассе)", "= «сто товаров»", "! 안 가요 — тут 안 значит «не»"].join("\n"),
    );
    expect(parsed.remarks).toEqual(["Просто «ниже», пара к 위."]);
    expect(parsed.groups.map((g) => g.kind)).toEqual(["similar", "opposite", "phrase", "literal", "warn"]);
    expect(parsed.groups[0]!.items).toEqual([{ head: "밑", text: "прямо под, вплотную" }]);
    expect(parsed.groups[2]!.items).toEqual([
      { head: "아래층", text: "нижний этаж" },
      { head: "아래요", text: "«ниже» (на кассе)" },
    ]);
    expect(parsed.groups[3]!.items).toEqual([{ text: "«сто товаров»" }]);
    expect(parsed.groups[4]!.items).toEqual([{ text: "안 가요 — тут 안 значит «не»" }]);
  });

  it("takes a Korean phrase of several words as the head", () => {
    expect(parseNotes("+ 하나 더 위에요 — на одну выше").groups[0]!.items[0]).toEqual({ head: "하나 더 위에요", text: "на одну выше" });
  });

  it("reads the old ≠ X. style", () => {
    expect(parseNotes("≠ 속. 안 — «внутри границ».").groups[0]!.items[0]).toEqual({ head: "속", text: "안 — «внутри границ»." });
  });

  it("leaves a head out when the point opens in Russian", () => {
    expect(parseNotes("≈ тоже 영화관").groups[0]!.items[0]).toEqual({ text: "тоже 영화관" });
  });

  it("knows hand-typed marks and keeps a hyphenated word a remark", () => {
    const parsed = parseNotes("- 아래층 — нижний этаж\n<> 위\n-ㄴ/은 — окончание");
    expect(parsed.groups.map((g) => g.kind)).toEqual(["opposite", "phrase"]);
    expect(parsed.groups[0]!.items[0]).toEqual({ head: "위", text: "" });
    expect(parsed.remarks).toEqual(["-ㄴ/은 — окончание"]);
  });

  it("is empty for no notes", () => {
    expect(parseNotes(null)).toEqual({ remarks: [], groups: [] });
  });
});

describe("cardNotes", () => {
  const 밑 = { id: 97, korean: "밑", meaning: "низ, дно", note: "밑 — прямо под; 아래 — просто ниже" };

  it("folds a ≠ line into the linked similar word", () => {
    const notes = cardNotes("≠ 밑 — ещё «дно»: 바다 밑\n≠ 위층 — верхний этаж", [밑]);
    expect(notes.groups[0]!.items).toEqual([
      { head: "밑", text: "ещё «дно»: 바다 밑", linked: 밑, gloss: "прямо под" },
      { head: "위층", text: "верхний этаж" },
    ]);
  });

  it("puts linked words first even without notes", () => {
    expect(cardNotes(undefined, [밑]).groups).toEqual([{ kind: "similar", items: [{ head: "밑", text: "", linked: 밑, gloss: "прямо под" }] }]);
  });

  it("shows the whole note next to the meaning when it can't be split", () => {
    const 속 = { id: 5, korean: "속", meaning: "внутренность", note: "속 глубже, чем 안" };
    expect(cardNotes(null, [속]).groups[0]!.items).toEqual([{ head: "속", text: 속.note, linked: 속, gloss: "внутренность" }]);
  });

  it("doesn't repeat a linked word under Opposite or Close in meaning", () => {
    const 공부하다 = { id: 1, korean: "공부하다", meaning: "учиться", note: "배우다 — у кого-то; 공부하다 — самому: читать, повторять" };
    const 가르치다 = { id: 2, korean: "가르치다", meaning: "учить", note: "가르치다 — учить кого-то; 배우다 — учиться" };
    const notes = cardNotes("↔ 가르치다 — учить кого-то\n≈ 공부하다 — заниматься\n≈ 익히다 — осваивать", [공부하다, 가르치다]);
    expect(notes.groups.map((g) => g.kind)).toEqual(["similar", "near"]);
    expect(notes.groups[0]!.items.map((i) => [i.head, i.gloss, i.text])).toEqual([
      ["공부하다", "самому: читать, повторять", ""],
      ["가르치다", "учить кого-то", ""],
    ]);
    expect(notes.groups[1]!.items).toEqual([{ head: "익히다", text: "осваивать" }]);
  });
});

describe("noteAbout", () => {
  const note = "매다 — завязывать (가방 끈, 넥타이); 메다 — носить на плече (가방). Звучат одинаково!";

  it("takes the word's part of the pair note and keeps the remark about the pair", () => {
    expect(noteAbout(note, "메다")).toBe("носить на плече (가방). Звучат одинаково!");
    expect(noteAbout(note, "매다")).toBe("завязывать (가방 끈, 넥타이). Звучат одинаково!");
  });

  it("finds nothing in a note of another shape", () => {
    expect(noteAbout("속 глубже, чем 안", "속")).toBeUndefined();
  });
});

describe("koreanRuns", () => {
  it("splits out Korean words and phrases", () => {
    expect(koreanRuns("пара к 위: 아래층 «этаж»")).toEqual([
      { text: "пара к ", ko: false },
      { text: "위", ko: true },
      { text: ": ", ko: false },
      { text: "아래층", ko: true },
      { text: " «этаж»", ko: false },
    ]);
    expect(koreanRuns("안 가요")).toEqual([{ text: "안 가요", ko: true }]);
  });
});
