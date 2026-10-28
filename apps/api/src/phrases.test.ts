import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCards } from "./cardStore.js";
import { openDb } from "./db/client.js";
import { decoyCount, grammarVariants, linkParts, phraseBlocks, phraseTiles } from "./phrases.js";
import { dueQueue } from "./reviewStore.js";
import { testApp } from "./testing.js";
import { OWNER_ID } from "./users.js";

const now = new Date("2026-10-28T09:00:00Z");

describe("phrases", () => {
  it("splits a phrase into blocks", () => {
    expect(phraseBlocks("어떻게 지내요?")).toEqual(["어떻게", "지내요"]);
    expect(phraseBlocks("감사합니다.")).toEqual(["감사", "합니다"]);
    expect(phraseBlocks("네")).toEqual(["네"]);
    // Its own breakdown, when the pieces spell it.
    expect(phraseBlocks("화장실이 어디예요?", [
      { ko: "화장실", meaning: "туалет" },
      { ko: "이", meaning: "(подлежащее)" },
      { ko: "어디", meaning: "где" },
      { ko: "예요", meaning: "есть" },
    ])).toEqual(["화장실", "이", "어디", "예요"]);
    // Pieces that don't spell it are ignored.
    expect(phraseBlocks("안녕히 가세요", [{ ko: "가다", meaning: "идти" }])).toEqual(["안녕히", "가세요"]);
  });

  it("makes grammar look-alikes of a block", () => {
    expect(grammarVariants("화장실이")).toEqual(["화장실가", "화장실을"]);
    expect(grammarVariants("어디예요")).toEqual(["어디이에요", "어디에요"]);
    expect(grammarVariants("밥을")).toEqual(["밥를", "밥은"]);
    expect(grammarVariants("이")).toEqual([]);
  });

  it("gives each phrase its blocks and wrong ones that are never its own", () => {
    const db = openDb(":memory:");
    const { created } = createCards(
      db,
      OWNER_ID,
      [
        { korean: "화장실이 어디예요?", meaning: "Где туалет?", kind: "phrase", tags: [] },
        { korean: "안녕히 가세요", meaning: "До свидания", kind: "phrase", tags: [] },
        { korean: "잘 먹겠습니다", meaning: "Приятного аппетита", kind: "phrase", tags: [] },
        { korean: "물", meaning: "вода", tags: [] },
      ],
      "app",
      now,
    );
    const id = created[0]!.id;
    const tiles = phraseTiles(db, OWNER_ID, [id, created[3]!.id], () => 0.3);
    expect(Object.keys(tiles)).toEqual([String(id)]);
    const { blocks, decoys } = tiles[id]!;
    expect(blocks).toEqual(["화장실이", "어디예요"]);
    expect(decoys).toHaveLength(decoyCount(2));
    expect(decoys.some((d) => d.startsWith("화장실") || d.startsWith("어디"))).toBe(true);
    expect(decoys.filter((d) => blocks.includes(d))).toEqual([]);
    expect(new Set(decoys).size).toBe(decoys.length);
  });

  it("links a phrase's pieces to the user's words", () => {
    const db = openDb(":memory:");
    const { created } = createCards(db, OWNER_ID, [{ korean: "가다", meaning: "идти", tags: [] }], "app", now);
    expect(
      linkParts(db, OWNER_ID, [
        { ko: "안녕히", meaning: "спокойно" },
        { ko: "가세요", base: "가다", meaning: "идите" },
      ]),
    ).toEqual([
      { ko: "안녕히", meaning: "спокойно" },
      { ko: "가세요", base: "가다", meaning: "идите", cardId: created[0]!.id },
    ]);
  });

  it("keeps phrases out of the speech queue", () => {
    const db = openDb(":memory:");
    createCards(db, OWNER_ID, [{ korean: "안녕히 가세요", meaning: "До свидания", kind: "phrase", tags: [] }], "app", now);
    expect(dueQueue(db, OWNER_ID, "meaning", now).map((i) => i.card.kind)).toEqual(["phrase"]);
    expect(dueQueue(db, OWNER_ID, "speech", now)).toEqual([]);
  });

  it("serves blocks, a phrase filter and linked parts over HTTP", async () => {
    const t = testApp();
    await t.signIn();
    await t.request("/cards", { body: { korean: "가다", meaning: "идти" } });
    const phrase = (
      await t.request("/cards", {
        body: {
          korean: "안녕히 가세요",
          meaning: "До свидания",
          kind: "phrase",
          register: "polite",
          parts: [
            { ko: "안녕히", meaning: "спокойно" },
            { ko: "가세요", base: "가다", meaning: "идите" },
          ],
        },
      })
    ).json.card;
    expect(phrase).toMatchObject({ kind: "phrase", register: "polite" });
    const res = await t.request(`/reviews/blocks?cardIds=${phrase.id}`);
    expect(res.json.tiles[phrase.id].blocks).toEqual(["안녕히", "가세요"]);
    expect((await t.request("/cards?kind=phrase")).json.cards.map((c: any) => c.id)).toEqual([phrase.id]);
    expect((await t.request(`/cards/${phrase.id}`)).json.card.parts[1].cardId).toEqual(expect.any(Number));
    expect((await t.request("/cards/summary")).json.counts.phrases).toBe(1);

    // Rated in the meaning schedule like a word.
    const review = { id: randomUUID(), cardId: phrase.id, mode: "meaning", rating: "good", reviewedAt: t.clock.now.toISOString() };
    expect((await t.request("/reviews", { body: { reviews: [review] } })).json.results[0].status).toBe("applied");
  });
});
