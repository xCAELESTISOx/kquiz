import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reviewLog, reviewStates } from "./db/schema.js";
import { testApp } from "./testing.js";

const DAY = 86_400_000;

/** Three words learned two days ago, reviewed then in every mode they have, none due yet. */
async function learned() {
  const t = testApp();
  await t.signIn();
  const ids: Record<string, number> = {};
  for (const korean of ["물", "불", "꽃"]) ids[korean] = (await t.request("/cards", { body: { korean, meaning: `м-${korean}` } })).json.card.id;
  const reviews = Object.values(ids).flatMap((cardId) =>
    (["meaning", "speech"] as const).map((mode) => ({ id: randomUUID(), cardId, mode, rating: "easy", reviewedAt: t.clock.now.toISOString() })),
  );
  await t.request("/reviews", { body: { reviews } });
  t.clock.now = new Date(t.clock.now.getTime() + 2 * DAY);
  return { t, ids };
}

const extra = async (t: Awaited<ReturnType<typeof learned>>["t"], query = "") => (await t.request(`/reviews/extra${query}`)).json.items as any[];

describe("extra practice", () => {
  it("gives learned words not due, once each, asked by giving the Korean", async () => {
    const { t, ids } = await learned();
    const items = await extra(t);
    expect(items.map((i) => i.card.korean).sort()).toEqual(["꽃", "물", "불"]);
    expect(items.every((i) => i.extra === true && i.mode === "speech")).toBe(true);
    expect((await extra(t, `?exclude=${ids["물"]},${ids["불"]}`)).map((i) => i.card.korean)).toEqual(["꽃"]);
    expect(await extra(t, "?limit=2")).toHaveLength(2);
  });

  it("leaves out a word due in any mode or reviewed today", async () => {
    const { t, ids } = await learned();
    t.db.update(reviewStates).set({ due: t.clock.now }).run();
    expect(await extra(t)).toEqual([]);
    const { t: t2, ids: ids2 } = await learned();
    await t2.request("/reviews", {
      body: { reviews: [{ id: randomUUID(), cardId: ids2["물"], mode: "meaning", rating: "good", reviewedAt: t2.clock.now.toISOString() }] },
    });
    expect((await extra(t2)).map((i) => i.card.korean).sort()).toEqual(["꽃", "불"]);
    void ids;
  });

  it("puts the words missed most first", async () => {
    const { t, ids } = await learned();
    const at = new Date(t.clock.now.getTime() - DAY).toISOString();
    const tasks = [1, 2].map((n) => ({ n, at, phase: "main", card: { id: ids["불"] }, mode: "speech", task: "write", answers: [], result: "wrong" }));
    await t.request("/session-logs/ABC234", { method: "PUT", body: { startedAt: at, screen: "learn", tasks, events: [] } });
    expect((await extra(t))[0].card.korean).toBe("불");
  });

  it("leaves the schedule alone on a right answer and brings the review forward on a miss", async () => {
    const { t, ids } = await learned();
    const state = () => t.db.select().from(reviewStates).all().find((s) => s.cardId === ids["물"] && s.mode === "speech")!;
    const before = state();
    const logged = t.db.select().from(reviewLog).all().length;
    const send = (rating: string) =>
      t.request("/reviews", {
        body: { reviews: [{ id: randomUUID(), cardId: ids["물"], mode: "speech", rating, reviewedAt: t.clock.now.toISOString(), extra: true }] },
      });
    await send("good");
    expect(state()).toEqual(before);
    await send("again");
    expect(state()).toEqual({ ...before, due: t.clock.now });
    expect(t.db.select().from(reviewLog).all()).toHaveLength(logged);
    // It is due now, so it comes as a usual review, and no longer as extra practice.
    expect((await t.request("/reviews/queue?mode=speech")).json.items.map((i: any) => i.card.korean)).toEqual(["물"]);
    expect((await extra(t)).map((i) => i.card.korean)).not.toContain("물");
  });

  it("rejects a bad request", async () => {
    const { t } = await learned();
    expect((await t.request("/reviews/extra?limit=0")).status).toBe(400);
    expect((await t.request("/reviews/extra?exclude=a")).status).toBe(400);
  });
});
