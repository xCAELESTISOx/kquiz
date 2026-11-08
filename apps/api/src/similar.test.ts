import { describe, expect, it } from "vitest";
import { createCards, getCard } from "./cardStore.js";
import { distractors } from "./choices.js";
import { openDb } from "./db/client.js";
import { linkSimilar, MAX_SIMILAR, similarFor, unlinkSimilar } from "./similar.js";
import { SqliteCardStore } from "./storage/mcp.js";
import { testApp } from "./testing.js";
import { OWNER_ID } from "./users.js";

const now = new Date("2026-11-08T09:00:00Z");

function deck() {
  const db = openDb(":memory:");
  const { created } = createCards(
    db,
    OWNER_ID,
    [
      { korean: "휴지통", meaning: "корзина для бумаг", tags: [] },
      { korean: "쓰레기통", meaning: "мусорное ведро", tags: [] },
      { korean: "물", meaning: "вода", tags: [] },
      { korean: "불", meaning: "огонь", tags: [] },
      { korean: "산", meaning: "гора", tags: [] },
      { korean: "강", meaning: "река", tags: [] },
    ],
    "app",
    now,
  );
  return { db, ids: created.map((c) => c.id) };
}

describe("similar words", () => {
  it("links both ways, keeps the note, and unlinks", () => {
    const { db, ids } = deck();
    const [a, b] = ids as [number, number];
    expect(linkSimilar(db, OWNER_ID, b, a, "у стола / на кухне", now)).toBe("linked");
    expect(getCard(db, OWNER_ID, a)?.similar).toEqual([{ id: b, korean: "쓰레기통", meaning: "мусорное ведро", note: "у стола / на кухне" }]);
    expect(getCard(db, OWNER_ID, b)?.similar).toEqual([{ id: a, korean: "휴지통", meaning: "корзина для бумаг", note: "у стола / на кухне" }]);
    // Linking again without a note keeps it; "" clears it.
    linkSimilar(db, OWNER_ID, a, b, undefined, now);
    expect(similarFor(db, OWNER_ID, [a]).get(a)?.[0]?.note).toBe("у стола / на кухне");
    linkSimilar(db, OWNER_ID, a, b, "", now);
    expect(similarFor(db, OWNER_ID, [a]).get(a)?.[0]?.note).toBeNull();
    expect(linkSimilar(db, OWNER_ID, a, a, undefined, now)).toBe("same_card");
    expect(linkSimilar(db, OWNER_ID, a, 9999, undefined, now)).toBe("not_found");
    expect(unlinkSimilar(db, OWNER_ID, b, a)).toBe(true);
    expect(getCard(db, OWNER_ID, a)?.similar).toEqual([]);
  });

  it("caps the links of a card and drops them with the card", async () => {
    const t = testApp();
    await t.signIn();
    const ids: number[] = [];
    for (let i = 0; i <= MAX_SIMILAR + 1; i++) ids.push((await t.request("/cards", { body: { korean: `단어${"가나다라마바사아자차"[i]}`, meaning: `слово ${i}` } })).json.card.id);
    const [first, ...rest] = ids as [number, ...number[]];
    for (const other of rest.slice(0, MAX_SIMILAR)) expect((await t.request(`/cards/${first}/similar/${other}`, { method: "PUT", body: {} })).status).toBe(200);
    const over = await t.request(`/cards/${first}/similar/${rest[MAX_SIMILAR]}`, { method: "PUT", body: { note: "x" } });
    expect(over.json).toEqual({ error: "too_many" });
    await t.request(`/cards/${rest[0]}`, { method: "DELETE" });
    expect((await t.request(`/cards/${first}`)).json.card.similar).toHaveLength(MAX_SIMILAR - 1);
    const removed = await t.request(`/cards/${first}/similar/${rest[1]}`, { method: "DELETE" });
    expect(removed.json.card.similar).toHaveLength(MAX_SIMILAR - 2);
  });

  it("can't link another person's card", async () => {
    const t = testApp();
    await t.signIn();
    const mine = (await t.request("/cards", { body: { korean: "물", meaning: "вода" } })).json.card.id;
    const { db } = deck();
    expect(linkSimilar(db, OWNER_ID + 1, mine, mine + 1, undefined, now)).toBe("not_found");
    expect((await t.request(`/cards/${mine}/similar/99999`, { method: "PUT", body: {} })).status).toBe(404);
  });

  it("puts the similar word among the choices even past the synonym filter", () => {
    const { db, ids } = deck();
    const [a, b] = ids as [number, number];
    linkSimilar(db, OWNER_ID, a, b, undefined, now);
    const options = distractors(db, OWNER_ID, [a], () => 0.99)[a]!;
    expect(options[0]).toMatchObject({ id: b, korean: "쓰레기통" });
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
  });

  it("links by Korean text for Claude", async () => {
    const { db } = deck();
    const store = new SqliteCardStore(db, OWNER_ID);
    const result = await store.linkSimilar([
      { korean: "휴지통", other: "쓰레기 통", note: "разница" },
      { korean: "휴지통", other: "책장" },
    ]);
    expect(result.linked).toEqual([{ korean: "휴지통", other: "쓰레기 통" }]);
    expect(result.rejected[0]?.reason).toContain("책장");
    const [card] = await store.find({ text: "휴지통", limit: 5 });
    expect(card?.similar).toEqual([{ id: expect.any(String), korean: "쓰레기통", meaning: "мусорное ведро", note: "разница" }]);
  });
});
