import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCards } from "./cardStore.js";
import { saveCardAudio } from "./cardAudio.js";
import { shuffle, spreadCards, type QueueItem } from "./reviewStore.js";
import { testApp } from "./testing.js";
import { OWNER_ID } from "./users.js";

async function signedIn() {
  const t = testApp();
  await t.signIn();
  return t;
}

const group = (t: Awaited<ReturnType<typeof signedIn>>, body: Record<string, unknown>) => t.request("/reviews/group", { body });

describe("reviewing a chosen group", () => {
  it("takes every card of a tag, due or not, and leaves the rest out", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards/bulk", {
      body: { cards: [{ korean: "사과", meaning: "яблоко", tags: ["еда"] }, { korean: "배", meaning: "груша", tags: ["еда"] }, { korean: "책", meaning: "книга" }] },
    });
    const [apple] = json.created;
    const review = { id: randomUUID(), cardId: apple.id, mode: "meaning", rating: "easy", reviewedAt: t.clock.now.toISOString() };
    await t.request("/reviews", { body: { reviews: [review] } });
    expect((await t.request("/reviews/queue?mode=meaning")).json.items).toHaveLength(2);

    const res = await group(t, { mode: "meaning", tag: "еда" });
    expect(res.json.total).toBe(2);
    expect(res.json.items.map((i: any) => i.card.korean).sort()).toEqual(["배", "사과"]);

    // A rating made in the group lands in the usual schedule.
    const early = { id: randomUUID(), cardId: apple.id, mode: "meaning", rating: "good", reviewedAt: t.clock.now.toISOString() };
    expect((await t.request("/reviews", { body: { reviews: [early] } })).json.results[0].status).toBe("applied");
  });

  it("finds a group by search and keeps paused and unspeakable cards to their rules", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards/bulk", {
      body: { cards: [{ korean: "물", meaning: "вода" }, { korean: "물병", meaning: "бутылка для воды" }, { korean: "TV 물", meaning: "водный канал" }] },
    });
    await t.request(`/cards/${json.created[1].id}`, { method: "PATCH", body: { suspended: true } });
    const meaning = await group(t, { mode: "meaning", q: "вод" });
    expect(meaning.json.items.map((i: any) => i.card.korean).sort()).toEqual(["TV 물", "물"]);
    expect(meaning.json.total).toBe(2);
    expect((await group(t, { mode: "speech", q: "вод" })).json.items.map((i: any) => i.card.korean)).toEqual(["물"]);
    expect((await group(t, { mode: "meaning", q: "вод", notReady: true })).json.items).toHaveLength(1);
  });

  it("takes queued cards of the group into reviews", async () => {
    const t = await signedIn();
    await t.request("/settings", { method: "PATCH", body: { newPerDay: 0 } });
    createCards(t.db, OWNER_ID, [{ korean: "고양이", meaning: "кошка", tags: ["животные"], examples: [] }, { korean: "개", meaning: "собака", tags: [], examples: [] }], "claude", t.clock.now);
    const res = await group(t, { mode: "meaning", tag: "животные" });
    expect(res.json.items.map((i: any) => i.card.korean)).toEqual(["고양이"]);
    expect((await t.request("/reviews/stats")).json.newCards).toMatchObject({ queued: 1 });
  });

  it("rejects a bad request", async () => {
    const t = await signedIn();
    expect((await group(t, { mode: "nope" })).status).toBe(400);
  });
});

describe("mixed sessions", () => {
  it("puts every mode a card is due in into one queue", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards/bulk", {
      body: { cards: [{ korean: "물", meaning: "вода" }, { korean: "TV 보다", meaning: "смотреть ТВ" }] },
    });
    saveCardAudio(t.db, json.created[0].id, "물", new Uint8Array([1]), t.clock.now);
    const items = (await t.request("/reviews/queue?mode=mixed")).json.items as QueueItem[];
    expect(items.map((i) => `${i.card.korean}:${i.mode}`).sort()).toEqual(["TV 보다:meaning", "물:listening", "물:meaning", "물:speech"]);

    // A rating names its own mode, and only that schedule moves.
    const speech = items.find((i) => i.mode === "speech")!;
    const review = { id: randomUUID(), cardId: speech.card.id, mode: "speech", rating: "good", reviewedAt: t.clock.now.toISOString() };
    await t.request("/reviews", { body: { reviews: [review] } });
    expect((await t.request("/reviews/queue?mode=mixed")).json.items).toHaveLength(3);
  });

  it("mixes only the modes asked for", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards/bulk", { body: { cards: [{ korean: "물", meaning: "вода", tags: ["еда"] }] } });
    saveCardAudio(t.db, json.created[0].id, "물", new Uint8Array([1]), t.clock.now);
    const modes = async (path: string) => ((await t.request(path)).json.items as QueueItem[]).map((i) => i.mode).sort();
    expect(await modes("/reviews/queue?mode=mixed&modes=meaning,listening")).toEqual(["listening", "meaning"]);
    expect(await modes("/reviews/queue?mode=mixed&modes=speech")).toEqual(["speech"]);
    expect((await t.request("/reviews/queue?mode=mixed&modes=nope")).status).toBe(400);
    const res = await group(t, { mode: "mixed", modes: ["speech", "listening"], tag: "еда" });
    expect(res.json.items.map((i: any) => i.mode).sort()).toEqual(["listening", "speech"]);
  });

  it("mixes the modes of a group", async () => {
    const t = await signedIn();
    await t.request("/cards/bulk", {
      body: { cards: [{ korean: "사과", meaning: "яблоко", tags: ["еда"] }, { korean: "책", meaning: "книга" }] },
    });
    const res = await group(t, { mode: "mixed", tag: "еда" });
    expect(res.json.total).toBe(1);
    expect(res.json.items.map((i: any) => i.mode).sort()).toEqual(["meaning", "speech"]);
  });

  it("keeps the same word apart where it can", () => {
    const items = [1, 2, 3].flatMap((id) =>
      (["meaning", "speech", "listening"] as const).map((mode) => ({ card: { id }, mode }) as unknown as QueueItem),
    );
    const ids = spreadCards(items, () => 0, 2).map((i) => i.card.id);
    expect(ids).toHaveLength(9);
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
  });
});

describe("shuffle", () => {
  it("keeps every item", () => {
    expect(shuffle([1, 2, 3, 4], () => 0).sort()).toEqual([1, 2, 3, 4]);
  });
});
