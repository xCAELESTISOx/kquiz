import { describe, expect, it } from "vitest";
import { createCards } from "./cardStore.js";
import { CHOICE_OPTIONS, distractors, senses } from "./choices.js";
import { openDb } from "./db/client.js";
import { OWNER_ID } from "./users.js";
import { testApp } from "./testing.js";

const now = new Date("2026-10-01T09:00:00Z");

describe("choices", () => {
  it("splits a translation into senses", () => {
    expect(senses("есть, кушать (о еде); Ёлка")).toEqual(new Set(["есть", "кушать", "елка"]));
  });

  it("picks look-alike words and never a synonym", () => {
    const db = openDb(":memory:");
    const { created } = createCards(
      db,
      OWNER_ID,
      [
        { korean: "먹다", meaning: "есть, кушать", tags: [] },
        { korean: "드시다", meaning: "кушать (вежл.)", tags: [] },
        { korean: "마시다", meaning: "пить", tags: [] },
        { korean: "가다", meaning: "идти", tags: [] },
        { korean: "보다", meaning: "смотреть", tags: [] },
        { korean: "감사합니다", meaning: "спасибо", tags: [] },
        { korean: "물", meaning: "вода", tags: [] },
      ],
      "app",
      now,
    );
    const target = created[0]!.id;
    const options = distractors(db, OWNER_ID, [target], () => 0)[target]!;
    expect(options).toHaveLength(CHOICE_OPTIONS - 1);
    // Verbs in 다 come before a noun or a phrase, and 드시다 is out: it also means "кушать".
    expect(options.map((o) => o.korean).sort()).toEqual(["가다", "마시다", "보다"]);
  });

  it("works with a tiny deck and skips other people's cards", async () => {
    const t = testApp();
    await t.signIn();
    const a = (await t.request("/cards", { body: { korean: "물", meaning: "вода" } })).json.card.id;
    await t.request("/cards", { body: { korean: "불", meaning: "огонь" } });
    const res = await t.request(`/reviews/choices?cardIds=${a},99999`);
    expect(res.status).toBe(200);
    expect(res.json.options).toEqual({ [a]: [expect.objectContaining({ korean: "불", meaning: "огонь" })] });
    expect((await t.request("/reviews/choices?cardIds=abc")).status).toBe(400);
  });
});
