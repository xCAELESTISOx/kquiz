import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCards } from "./cardStore.js";
import { startOfDay } from "./newCards.js";
import { shuffle } from "./reviewStore.js";
import { testApp } from "./testing.js";
import { OWNER_ID } from "./users.js";

async function signedIn() {
  const t = testApp();
  await t.signIn();
  return t;
}

/** Cards as Claude adds them through MCP. */
function fromClaude(t: Awaited<ReturnType<typeof signedIn>>, n: number) {
  const words = Array.from({ length: n }, (_, i) => ({ korean: `단어${String.fromCharCode(0xac00 + i)}`, meaning: `слово ${i}`, tags: [] }));
  return createCards(t.db, OWNER_ID, words, "claude", t.clock.now).created;
}

const HOUR = 3_600_000;

describe("startOfDay", () => {
  it("finds local midnight", () => {
    // 01:30 in Seoul (UTC+9) is still the previous day in UTC.
    expect(startOfDay(new Date("2026-10-19T16:30:00Z"), "Asia/Seoul").toISOString()).toBe("2026-10-19T15:00:00.000Z");
    expect(startOfDay(new Date("2026-10-19T14:59:59Z"), "Asia/Seoul").toISOString()).toBe("2026-10-18T15:00:00.000Z");
    expect(startOfDay(new Date("2026-10-19T10:00:00Z"), "UTC").toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });
});

describe("new words", () => {
  it("wait in the pool, a few learned at a time, oldest first", async () => {
    const t = testApp({}, { learnNewWords: false });
    await t.signIn();
    const claude = fromClaude(t, 6);
    t.clock.now = new Date(t.clock.now.getTime() + HOUR);
    await t.request("/cards", { body: { korean: "물", meaning: "вода" } });

    const stats = (await t.request("/reviews/stats")).json;
    expect(stats.due).toEqual({ meaning: 0, speech: 0, listening: 0 });
    expect(stats.newCards).toMatchObject({ queued: 7, learning: 0, started: 0, fresh: 3, pool: 7 });
    // Today previews what "Учить" comes to: the first session takes three.
    expect(stats.newCards.next).toEqual(claude.slice(0, 3).map((c) => c.korean));
    expect((await t.request("/reviews/queue?mode=meaning")).json.items).toHaveLength(0);

    const learning = (await t.request("/cards/learning")).json;
    expect(learning.items.map((i: any) => i.card.id)).toEqual(claude.slice(0, 3).map((c) => c.id));
    expect(learning.items.every((i: any) => i.step === 0)).toBe(true);
    expect(learning.pool).toBe(4);
    // Today shows how many are in learning and which come first: those, then the pool.
    const after = (await t.request("/reviews/stats")).json.newCards;
    expect(after).toMatchObject({ learning: 3, started: 3, fresh: 0 });
    expect(after.next).toEqual(claude.slice(0, 3).map((c) => c.korean));
    // Asking again gives the same words.
    expect((await t.request("/cards/learning")).json.items.map((i: any) => i.card.id)).toEqual(learning.items.map((i: any) => i.card.id));
  });

  it("climb the ladder, a miss one step down, then wait for a check and enter reviews", async () => {
    const t = testApp({}, { learnNewWords: false });
    await t.signIn();
    const words = fromClaude(t, 6);
    const id = words[0]!.id;
    await t.request("/cards/learning");
    const answer = (ok: boolean, card = id) => t.request(`/cards/${card}/learning`, { body: { ok } }).then((r) => r.json);

    expect(await answer(true)).toEqual({ status: "climbed", step: 1 });
    expect(await answer(false)).toEqual({ status: "missed", step: 0 });
    expect(await answer(false)).toEqual({ status: "missed", step: 0 });
    expect(await answer(true)).toEqual({ status: "climbed", step: 1 });
    expect(await answer(true)).toEqual({ status: "climbed", step: 2 });
    const passed = await answer(true);
    // At the top it makes room on the ladder: the fourth word comes in.
    expect(passed).toMatchObject({ status: "passed", next: { card: { id: words[3]!.id }, step: 0 } });
    let session = (await t.request("/cards/learning")).json;
    expect(session.items.map((i: any) => i.card.id)).not.toContain(id);
    expect(session.pool).toBe(2);

    // Three hours on, it is checked; a miss puts it back on the last step, not the bottom.
    t.clock.now = new Date(t.clock.now.getTime() + 3 * HOUR);
    session = (await t.request("/cards/learning")).json;
    expect(session.items[0]).toMatchObject({ card: { id }, step: "check" });
    expect(await answer(false)).toEqual({ status: "missed", step: 2 });
    expect((await t.request("/cards/learning")).json.items.find((i: any) => i.card.id === id).step).toBe(2);
    expect((await answer(true)).status).toBe("passed");
    t.clock.now = new Date(t.clock.now.getTime() + 3 * HOUR);
    // 01:00 in Seoul now: learned, it is due at the next midnight.
    expect(await answer(true)).toEqual({ status: "learned", due: "2026-10-20T15:00:00.000Z" });
    expect((await t.request(`/cards/${id}`)).json.card.queued).toBe(false);
    expect((await t.request("/reviews/stats")).json).toMatchObject({ learned: 1, learnedToday: 1 });
    // Statistics agree with Today, and the word is in tomorrow's forecast; three more are being learned.
    const overview = (await t.request("/stats?tz=540")).json;
    expect(overview).toMatchObject({ learned: 1, learning: 3 });
    expect(overview.forecast[1]).toMatchObject({ words: 1 });
    expect((await answer(true)).status).toBeUndefined();
    expect((await t.request(`/cards/${id}/learning`, { body: { ok: true } })).status).toBe(409);
    expect((await t.request("/cards/999/learning", { body: { ok: true } })).status).toBe(404);
    expect((await t.request(`/cards/${id}/learning`, { body: {} })).status).toBe(400);
    t.clock.now = new Date("2026-10-20T15:00:00Z");
    expect((await t.request("/reviews/stats")).json.due.meaning).toBe(1);
  });

  it("keep coming with no daily cap: a word up the ladder makes room at once", async () => {
    const t = testApp({}, { learnNewWords: false });
    await t.signIn();
    const words = fromClaude(t, 10);
    await t.request("/cards/learning");
    const answer = (card: number) => t.request(`/cards/${card}/learning`, { body: { ok: true } }).then((r) => r.json);
    const climb = async (card: number) => {
      await answer(card);
      await answer(card);
      return answer(card);
    };
    // Three on the ladder; each one up it is replaced by the next from the pool, however many wait.
    for (let i = 0; i < 6; i++) expect((await climb(words[i]!.id)).next.card.id).toBe(words[i + 3]!.id);
    let session = (await t.request("/cards/learning")).json;
    expect(session.items.map((i: any) => i.card.id)).toEqual([words[6]!.id, words[7]!.id, words[8]!.id]);
    expect((await t.request("/reviews/stats")).json.newCards).toMatchObject({ started: 3, fresh: 0, pool: 1 });
    // Three on, the last one comes too; three hours later, the checks come first.
    expect((await climb(words[6]!.id)).next.card.id).toBe(words[9]!.id);
    t.clock.now = new Date(t.clock.now.getTime() + 3 * HOUR);
    session = (await t.request("/cards/learning")).json;
    expect(session.items.slice(0, 7).map((i: any) => i.step)).toEqual(Array(7).fill("check"));
  });

  it("enter reviews after learning a group: tomorrow, or later today if missed", async () => {
    const t = testApp({}, { learnNewWords: false });
    await t.signIn();
    const [a, b] = fromClaude(t, 3);
    const res = await t.request("/cards/learned", { body: { cardIds: [a!.id, b!.id], missed: [b!.id] } });
    expect(res.json.introduced.sort()).toEqual([a!.id, b!.id].sort());
    expect((await t.request("/cards/learned", { body: { cardIds: [a!.id] } })).json.introduced).toEqual([]);
    expect((await t.request("/reviews/stats")).json.newCards).toMatchObject({ queued: 1 });
    t.clock.now = new Date(t.clock.now.getTime() + 2 * HOUR);
    expect((await t.request("/reviews/queue?mode=meaning")).json.items.map((i: any) => i.card.id)).toEqual([b!.id]);
    expect((await t.request("/cards/learned", { body: { cardIds: [] } })).status).toBe(400);
  });

  it("can be pulled in by hand, unlearned", async () => {
    const t = testApp({}, { learnNewWords: false });
    await t.signIn();
    const [a] = fromClaude(t, 2);
    const pulled = await t.request(`/cards/${a!.id}/introduce`, { body: {} });
    expect(pulled.json.card.queued).toBe(false);
    expect((await t.request(`/cards/${a!.id}/introduce`, { body: {} })).status).toBe(409);
    expect((await t.request("/reviews/stats")).json).toMatchObject({ due: { meaning: 1 }, newCards: { queued: 1 } });
  });

  it("keeps paused cards out of reviews and the daily pick", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards", { body: { korean: "물", meaning: "вода" } });
    const paused = await t.request(`/cards/${json.card.id}`, { method: "PATCH", body: { suspended: true } });
    expect(paused.json.card.suspended).toBe(true);
    expect((await t.request("/reviews/queue?mode=meaning")).json.items).toHaveLength(0);
    expect((await t.request("/reviews/stats")).json.due).toEqual({ meaning: 0, speech: 0, listening: 0 });
    expect((await t.request("/cards?status=paused")).json.cards).toHaveLength(1);
    await t.request(`/cards/${json.card.id}`, { method: "PATCH", body: { suspended: false } });
    expect((await t.request("/reviews/queue?mode=meaning")).json.items).toHaveLength(1);
  });

  it("validates settings", async () => {
    const t = await signedIn();
    expect((await t.request("/settings")).json).toEqual({ newPerDay: 15 });
    expect((await t.request("/settings", { method: "PATCH", body: { newPerDay: -1 } })).status).toBe(400);
    expect((await t.request("/settings", { method: "PATCH", body: { newPerDay: 20 } })).json).toEqual({ newPerDay: 20 });
  });
});

describe("shuffle", () => {
  it("mixes the order and keeps every item", () => {
    const values = [0, 0, 0];
    expect(shuffle([1, 2, 3, 4], () => values.shift()!)).toEqual([2, 3, 4, 1]);
    const many = Array.from({ length: 50 }, (_, i) => i);
    const mixed = shuffle(many);
    expect([...mixed].sort((a, b) => a - b)).toEqual(many);
    expect(mixed).not.toEqual(many);
  });
});

describe("cards summary and export", () => {
  it("counts cards by status and tag", async () => {
    const t = await signedIn();
    await t.request("/cards/bulk", { body: { cards: [{ korean: "사과", meaning: "яблоко", tags: ["еда"] }, { korean: "배", meaning: "груша", tags: ["еда", "фрукты"] }] } });
    fromClaude(t, 1);
    const res = await t.request("/cards/summary");
    expect(res.json).toEqual({
      counts: { all: 3, queued: 1, paused: 0, phrases: 0 },
      tags: [
        { tag: "еда", count: 2 },
        { tag: "фрукты", count: 1 },
      ],
    });
  });

  it("exports cards, schedules and history as a download", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards", { body: { korean: "물", meaning: "вода" } });
    const review = { id: randomUUID(), cardId: json.card.id, mode: "meaning", rating: "good", reviewedAt: t.clock.now.toISOString() };
    await t.request("/reviews", { body: { reviews: [review] } });
    const res = await t.request("/export");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="kquiz-2026-10-19.json"');
    expect(res.json).toMatchObject({ app: "kquiz", version: 1, settings: { newPerDay: 15 }, attempts: [] });
    expect(res.json.cards).toHaveLength(1);
    expect(res.json.cards[0].reviewStates.map((s: any) => s.mode).sort()).toEqual(["listening", "meaning", "speech"]);
    expect(res.json.reviewLog).toHaveLength(1);
  });

  it("requires a session for settings and export", async () => {
    const t = testApp();
    expect((await t.request("/export")).status).toBe(401);
    expect((await t.request("/settings")).status).toBe(401);
  });
});
