import { describe, expect, it } from "vitest";
import { cardNotes, koreanRuns, parseNotes } from "./notes";

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
      { head: "밑", text: "ещё «дно»: 바다 밑", linked: 밑 },
      { head: "위층", text: "верхний этаж" },
    ]);
  });

  it("puts linked words first even without notes", () => {
    expect(cardNotes(undefined, [밑]).groups).toEqual([{ kind: "similar", items: [{ head: "밑", text: 밑.note, linked: 밑 }] }]);
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
