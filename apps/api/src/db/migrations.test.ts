import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCards } from "../cardStore.js";
import { openDb } from "./client.js";
import { cards, reviewStates } from "./schema.js";

describe("migrations", () => {
  it("0004 gives cards made before listening mode a fresh listening schedule", () => {
    const db = openDb(":memory:");
    createCards(db, [{ korean: "물", meaning: "вода", tags: [] }], "app");
    db.$client.exec("delete from review_states where mode = 'listening'");
    db.$client.exec(readFileSync(new URL("../../drizzle/0004_listening.sql", import.meta.url), "utf8"));
    const modes = db.select({ mode: reviewStates.mode, reps: reviewStates.reps }).from(reviewStates).all();
    expect(modes.map((m) => m.mode).sort()).toEqual(["listening", "meaning", "speech"]);
    expect(modes.every((m) => m.reps === 0)).toBe(true);
  });

  it("0005 counts cards made before the new-card queue as already introduced", () => {
    const db = openDb(":memory:");
    createCards(db, [{ korean: "물", meaning: "вода", tags: [] }], "claude");
    expect(db.select({ at: cards.introducedAt }).from(cards).get()?.at).toBeNull();
    db.$client.exec(readFileSync(new URL("../../drizzle/0005_card_queue.sql", import.meta.url), "utf8").split("--> statement-breakpoint").at(-1)!);
    const row = db.select({ at: cards.introducedAt, how: cards.introduction, created: cards.createdAt }).from(cards).get();
    expect(row).toMatchObject({ how: "direct", at: row?.created });
  });
});
