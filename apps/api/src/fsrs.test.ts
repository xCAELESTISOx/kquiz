import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createCards } from "./cardStore.js";
import { openDb, type Db } from "./db/client.js";
import { reviewStates } from "./db/schema.js";
import { getFsrsSetup, schedulerFor, setDesiredRetention } from "./fsrs.js";
import { MIN_REVIEWS, optimizeMode, reviewDay, trainingItems } from "./fsrsOptimizer.js";
import { applyRating, newReviewState, type RatingName } from "./review.js";
import { applyReviews } from "./reviewStore.js";
import { testApp } from "./testing.js";

const TZ = "Asia/Seoul";
const start = new Date("2026-01-05T01:00:00Z");

/** A learner who forgets more the longer a card waits: deterministic, so tests are stable. */
function simulate(db: Db, cardCount: number, reviewsPerCard: number) {
  let seed = 42;
  const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
  const { created } = createCards(
    db,
    Array.from({ length: cardCount }, (_, i) => ({ korean: `단어${String.fromCharCode(0xac00 + i)}`, meaning: `слово ${i}`, examples: [], tags: [] })),
    "app",
    start,
  );
  const latest = new Date("2027-12-31T00:00:00Z");
  for (const card of created) {
    let at = new Date(start.getTime() + random() * 86_400_000);
    for (let n = 0; n < reviewsPerCard; n++) {
      const row = db.select().from(reviewStates).where(and(eq(reviewStates.cardId, card.id), eq(reviewStates.mode, "meaning"))).get()!;
      if (n > 0) at = new Date(Math.max(row.due.getTime(), at.getTime()) + random() * 3_600_000);
      const days = row.lastReview ? (at.getTime() - row.lastReview.getTime()) / 86_400_000 : 0;
      const recall = Math.exp(-days / (2 + 6 * n));
      const rating: RatingName = random() < recall ? (random() < 0.15 ? "easy" : "good") : random() < 0.3 ? "hard" : "again";
      applyReviews(db, [{ id: randomUUID(), cardId: card.id, mode: "meaning", rating, reviewedAt: at }], latest);
    }
  }
}

describe("fsrs days", () => {
  it("starts a review day at 4 am local time", () => {
    // 03:59 and 04:00 in Seoul are 18:59 and 19:00 UTC the day before.
    const before = reviewDay(new Date("2026-10-18T18:59:00Z"), TZ);
    const after = reviewDay(new Date("2026-10-18T19:00:00Z"), TZ);
    expect(after - before).toBe(1);
    expect(reviewDay(new Date("2026-10-19T14:00:00Z"), TZ)).toBe(after);
  });

  it("builds one item per later review and drops same-day-only histories", () => {
    const at = (iso: string) => new Date(iso);
    const items = trainingItems(
      [
        { cardId: 1, rating: "good", reviewedAt: at("2026-10-19T01:00:00Z") },
        { cardId: 1, rating: "good", reviewedAt: at("2026-10-19T01:10:00Z") },
        { cardId: 1, rating: "again", reviewedAt: at("2026-10-21T01:00:00Z") },
        { cardId: 2, rating: "easy", reviewedAt: at("2026-10-19T02:00:00Z") },
      ],
      TZ,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.reviews.map((r) => [r.rating, r.deltaT])).toEqual([
      [3, 0],
      [3, 0],
      [1, 2],
    ]);
  });
});

describe("fsrs weights", () => {
  it("keeps the defaults until there are enough reviews", async () => {
    const db = openDb(":memory:");
    simulate(db, 20, 5);
    expect(await optimizeMode(db, "meaning", { timeZone: TZ, now: new Date("2027-06-01T00:00:00Z") })).toEqual({
      status: "not_enough_reviews",
      reviews: 100,
    });
    expect(getFsrsSetup(db, "meaning").weights).toBeNull();
  });

  it("fits the owner's history once there is enough, and only once a month", async () => {
    const db = openDb(":memory:");
    simulate(db, 250, 6);
    const now = new Date("2027-06-01T00:00:00Z");
    const dueBefore = db.select().from(reviewStates).where(eq(reviewStates.mode, "meaning")).all();

    const result = await optimizeMode(db, "meaning", { timeZone: TZ, now });
    expect(result.reviews).toBeGreaterThanOrEqual(MIN_REVIEWS);
    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.logLoss).toBeLessThan(result.previousLogLoss);

    const weights = getFsrsSetup(db, "meaning").weights!;
    expect(weights).toHaveLength(21);
    // Memory states were replayed with the new weights; due dates were left alone.
    const after = db.select().from(reviewStates).where(eq(reviewStates.mode, "meaning")).all();
    expect(after.map((r) => r.due.getTime())).toEqual(dueBefore.map((r) => r.due.getTime()));
    expect(after.some((r, i) => r.stability !== dueBefore[i]!.stability)).toBe(true);
    // Speech has no history of its own, so it keeps the defaults.
    expect(getFsrsSetup(db, "speech").weights).toBeNull();

    expect((await optimizeMode(db, "meaning", { timeZone: TZ, now })).status).toBe("up_to_date");
  });
});

describe("fsrs retention", () => {
  it("schedules sooner for a higher target retention", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    const learned = applyRating(newReviewState(now), "easy", now);
    const later = new Date(learned.due.getTime());
    const interval = (retention: number) =>
      applyRating(learned, "good", later, schedulerFor({ desiredRetention: retention, weights: null }, false)).scheduled_days;
    expect(interval(0.95)).toBeLessThan(interval(0.85));
  });

  it("is set per mode through the API", async () => {
    const t = testApp();
    await t.signIn();
    const initial = await t.request("/reviews/fsrs");
    expect(initial.json.modes).toEqual([
      expect.objectContaining({ mode: "meaning", desiredRetention: 0.9, personal: false, reviews: 0, minReviews: MIN_REVIEWS }),
      expect.objectContaining({ mode: "speech", desiredRetention: 0.9, personal: false }),
      expect.objectContaining({ mode: "listening", desiredRetention: 0.9, personal: false }),
    ]);
    const res = await t.request("/reviews/fsrs", { method: "PUT", body: { mode: "speech", desiredRetention: 0.85 } });
    expect(res.status).toBe(200);
    expect(res.json.modes[1].desiredRetention).toBe(0.85);
    expect(getFsrsSetup(t.db, "meaning").desiredRetention).toBe(0.9);
    expect((await t.request("/reviews/fsrs", { method: "PUT", body: { mode: "speech", desiredRetention: 0.7 } })).status).toBe(400);
    setDesiredRetention(t.db, "meaning", 0.93);
    expect((await t.request("/reviews/fsrs")).json.modes[0].desiredRetention).toBe(0.93);
  });

  it("needs a session", async () => {
    const t = testApp();
    expect((await t.request("/reviews/fsrs")).status).toBe(401);
  });
});
