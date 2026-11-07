import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createCards, updateCard } from "./cardStore.js";
import { createReviewing } from "./testing.js";
import { openDb } from "./db/client.js";
import { cards } from "./db/schema.js";
import { findLeeches, LEECH_THRESHOLD } from "./leeches.js";
import type { RatingName, ReviewMode } from "./review.js";
import { applyReviews } from "./reviewStore.js";
import { OWNER_ID } from "./users.js";

const DAY = 86_400_000;
const start = new Date("2026-10-01T09:00:00Z");

function setup() {
  const db = openDb(":memory:");
  const { created } = createReviewing(db, OWNER_ID, [{ korean: "어렵다", meaning: "трудный", tags: [] }, { korean: "쉽다", meaning: "лёгкий", tags: [] }], "app", start);
  return { db, hard: created[0]!.id, easy: created[1]!.id };
}

function rate(db: ReturnType<typeof openDb>, cardId: number, rating: RatingName, at: Date, mode: ReviewMode = "meaning") {
  applyReviews(db, OWNER_ID, [{ id: randomUUID(), cardId, mode, rating, reviewedAt: at }], new Date("2027-01-01T00:00:00Z"));
}

describe("leeches", () => {
  it("flags a card forgotten on enough different days", () => {
    const { db, hard, easy } = setup();
    for (let d = 1; d < LEECH_THRESHOLD; d++) rate(db, hard, "again", new Date(start.getTime() + d * DAY));
    // Relearning the same day is still one forgetting.
    rate(db, hard, "again", new Date(start.getTime() + 1 * DAY + 600_000));
    rate(db, easy, "good", new Date(start.getTime() + DAY));
    expect(findLeeches(db, OWNER_ID)).toEqual([]);

    rate(db, hard, "again", new Date(start.getTime() + 20 * DAY));
    const leeches = findLeeches(db, OWNER_ID);
    expect(leeches.map((l) => [l.card.id, l.forgotten])).toEqual([[hard, { meaning: LEECH_THRESHOLD }]]);
    expect(leeches[0]!.lastForgottenAt).toBe(new Date(start.getTime() + 20 * DAY).toISOString());
  });

  it("leaves paused cards out", () => {
    const { db, hard } = setup();
    for (let d = 1; d <= LEECH_THRESHOLD; d++) rate(db, hard, "again", new Date(start.getTime() + d * DAY));
    db.update(cards).set({ suspended: true }).where(eq(cards.id, hard)).run();
    expect(findLeeches(db, OWNER_ID)).toEqual([]);
  });

  it("gives an edited card a fresh start", () => {
    const { db, hard } = setup();
    for (let d = 1; d <= LEECH_THRESHOLD; d++) rate(db, hard, "again", new Date(start.getTime() + d * DAY), "speech");
    expect(findLeeches(db, OWNER_ID)[0]?.forgotten).toEqual({ speech: LEECH_THRESHOLD });
    for (let d = 1; d <= LEECH_THRESHOLD; d++) rate(db, hard, "again", new Date(start.getTime() + d * DAY), "listening");
    expect(findLeeches(db, OWNER_ID)[0]?.forgotten).toEqual({ speech: LEECH_THRESHOLD, listening: LEECH_THRESHOLD });
    updateCard(db, OWNER_ID, hard, { notes: "мнемоника" }, new Date(start.getTime() + 30 * DAY));
    expect(findLeeches(db, OWNER_ID)).toEqual([]);
  });
});
