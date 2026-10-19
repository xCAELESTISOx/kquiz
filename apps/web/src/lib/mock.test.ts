import { describe, expect, it } from "vitest";
import { MockApi, type KeyValueStorage } from "./mock";

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe("MockApi", () => {
  it("adds cards and reports duplicates", () => {
    const api = new MockApi(memoryStorage());
    const result = api.addCards([{ korean: "하늘", meaning: "небо" }, { korean: " 물 ", meaning: "вода" }], "bulk");
    expect(result.created.map((c) => c.korean)).toEqual(["하늘"]);
    expect(result.duplicates.map((d) => d.korean)).toEqual(["물"]);
  });

  it("takes a reviewed card out of the queue and ignores repeated review ids", () => {
    let now = new Date("2026-10-19T10:00:00Z");
    const storage = memoryStorage();
    const api = new MockApi(storage, () => now);
    const [first] = api.queue("meaning");
    const review = { id: "r1", cardId: first!.id, mode: "meaning" as const, rating: "good" as const, reviewedAt: now.toISOString(), elapsedMs: 900 };
    const { due } = api.review(review);
    expect(api.queue("meaning").some((c) => c.id === first!.id)).toBe(false);

    now = new Date("2026-10-19T11:00:00Z");
    expect(api.review(review).due).toBe(due);
    // State survives a reload.
    expect(new MockApi(storage, () => now).stats().total).toBe(api.stats().total);
  });

  it("keeps non-speakable cards out of the speech queue", () => {
    const api = new MockApi(memoryStorage());
    api.addCards([{ korean: "TV 보다", meaning: "смотреть телевизор" }], "app");
    expect(api.queue("meaning").some((c) => c.korean === "TV 보다")).toBe(true);
    expect(api.queue("speech").some((c) => c.korean === "TV 보다")).toBe(false);
  });
});
