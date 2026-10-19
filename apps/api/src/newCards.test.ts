import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCards } from "./cardStore.js";
import { startOfDay } from "./newCards.js";
import { mixNew } from "./reviewStore.js";
import { testApp } from "./testing.js";

async function signedIn() {
  const t = testApp();
  await t.signIn();
  return t;
}

/** Cards as Claude adds them through MCP. */
function fromClaude(t: Awaited<ReturnType<typeof signedIn>>, n: number) {
  const words = Array.from({ length: n }, (_, i) => ({ korean: `단어${String.fromCharCode(0xac00 + i)}`, meaning: `слово ${i}`, tags: [] }));
  return createCards(t.db, words, "claude", t.clock.now).created;
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

describe("new-card queue", () => {
  it("queues cards from Claude and lets in the daily allowance", async () => {
    const t = await signedIn();
    await t.request("/settings", { method: "PATCH", body: { newPerDay: 3 } });
    const created = fromClaude(t, 10);
    expect(created.every((c) => c.queued)).toBe(true);

    const stats = await t.request("/reviews/stats");
    expect(stats.json.newCards).toEqual({ introduced: 3, limit: 3, queued: 7 });
    expect(stats.json.due.meaning).toBe(3);
    // Asking again the same day lets nothing more in.
    expect((await t.request("/reviews/queue?mode=meaning")).json.items).toHaveLength(3);
    expect((await t.request("/cards?status=queued")).json.cards).toHaveLength(7);

    // Next day (Seoul time) three more come in.
    t.clock.now = new Date(t.clock.now.getTime() + 24 * HOUR);
    expect((await t.request("/reviews/stats")).json.newCards).toEqual({ introduced: 3, limit: 3, queued: 4 });
  });

  it("puts cards added in the app straight into reviews", async () => {
    const t = await signedIn();
    await t.request("/settings", { method: "PATCH", body: { newPerDay: 0 } });
    const one = await t.request("/cards", { body: { korean: "물", meaning: "вода" } });
    expect(one.json.card.queued).toBe(false);
    await t.request("/cards/bulk", { body: { text: "불 — огонь" } });
    expect((await t.request("/reviews/stats")).json).toMatchObject({ due: { meaning: 2 }, newCards: { introduced: 0, queued: 0 } });
  });

  it("pulls a card in early without using up the allowance", async () => {
    const t = await signedIn();
    await t.request("/settings", { method: "PATCH", body: { newPerDay: 1 } });
    const [a, b] = fromClaude(t, 2);
    expect((await t.request("/reviews/stats")).json.newCards).toEqual({ introduced: 1, limit: 1, queued: 1 });
    const queued = (await t.request("/cards?status=queued")).json.cards[0];
    const pulled = await t.request(`/cards/${queued.id}/introduce`, { body: {} });
    expect(pulled.json.card.queued).toBe(false);
    expect((await t.request(`/cards/${queued.id}/introduce`, { body: {} })).status).toBe(409);
    expect((await t.request("/reviews/stats")).json).toMatchObject({ due: { meaning: 2 }, newCards: { introduced: 1, queued: 0 } });
    expect([a!.id, b!.id]).toContain(queued.id);
  });

  it("keeps paused cards out of reviews and the daily pick", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards", { body: { korean: "물", meaning: "вода" } });
    const paused = await t.request(`/cards/${json.card.id}`, { method: "PATCH", body: { suspended: true } });
    expect(paused.json.card.suspended).toBe(true);
    expect((await t.request("/reviews/queue?mode=meaning")).json.items).toHaveLength(0);
    expect((await t.request("/reviews/stats")).json.due).toEqual({ meaning: 0, speech: 0 });
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

describe("mixNew", () => {
  it("spreads new cards among reviews and keeps the reviews' order", () => {
    const items = [{ reps: 2, n: 1 }, { reps: 1, n: 2 }, { reps: 0, n: 3 }, { reps: 0, n: 4 }];
    const values = [0, 0.99];
    const mixed = mixNew(items, () => values.shift()!);
    expect(mixed.map((i) => i.n)).toEqual([3, 1, 2, 4]);
  });
});

describe("cards summary and export", () => {
  it("counts cards by status and tag", async () => {
    const t = await signedIn();
    await t.request("/cards/bulk", { body: { cards: [{ korean: "사과", meaning: "яблоко", tags: ["еда"] }, { korean: "배", meaning: "груша", tags: ["еда", "фрукты"] }] } });
    fromClaude(t, 1);
    const res = await t.request("/cards/summary");
    expect(res.json).toEqual({
      counts: { all: 3, queued: 1, paused: 0 },
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
    expect(res.json.cards[0].reviewStates.map((s: any) => s.mode).sort()).toEqual(["meaning", "speech"]);
    expect(res.json.reviewLog).toHaveLength(1);
  });

  it("requires a session for settings and export", async () => {
    const t = testApp();
    expect((await t.request("/export")).status).toBe(401);
    expect((await t.request("/settings")).status).toBe(401);
  });
});
