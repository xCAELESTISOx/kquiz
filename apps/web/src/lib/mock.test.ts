import { describe, expect, it } from "vitest";
import { MockApi, type KeyValueStorage } from "./mock";

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe("MockApi", () => {
  it("adds cards and reports duplicates ignoring spaces and punctuation", () => {
    const api = new MockApi(memoryStorage());
    const result = api.addCards([
      { korean: "하늘", meaning: "небо" },
      { korean: " 물! ", meaning: "вода" },
    ]);
    expect(result.created.map((c) => c.korean)).toEqual(["하늘"]);
    expect(result.duplicates.map((d) => d.korean)).toEqual(["물!"]);
    expect(api.addCard({ korean: "감사 합니다", meaning: "спасибо" }).status).toBe("duplicate");
  });

  it("takes a reviewed card out of the queue and ignores repeated review ids", () => {
    let now = new Date("2026-10-19T10:00:00Z");
    const storage = memoryStorage();
    const api = new MockApi(storage, () => now);
    const [first] = api.queue("meaning");
    const review = {
      id: "r1",
      cardId: first!.card.id,
      mode: "meaning" as const,
      rating: "good" as const,
      reviewedAt: now.toISOString(),
    };
    expect(api.review([review]).results[0]?.status).toBe("applied");
    expect(api.queue("meaning").some((item) => item.card.id === first!.card.id)).toBe(false);

    now = new Date("2026-10-19T11:00:00Z");
    expect(api.review([review]).results[0]?.status).toBe("duplicate");
    expect(api.review([{ ...review, id: "r2", cardId: 999 }]).results[0]?.status).toBe("card_not_found");
    // New words wait for "Учить", then come in tomorrow.
    const added = api.addCard({ korean: "새 단어", meaning: "новое слово" });
    const lesson = api.stats().newCards.lessons.at(-1)!;
    expect(lesson.count).toBeGreaterThan(0);
    if (added.status === "created") expect(api.learned([added.card.id], []).introduced).toEqual([added.card.id]);
    expect(api.queue("meaning").some((item) => item.card.korean === "새 단어")).toBe(false);
    // State survives a reload.
    const reloaded = new MockApi(storage, () => now).stats();
    expect(reloaded).toEqual(api.stats());
    expect(reloaded.reviewedToday).toBe(1);
  });

  it("keeps cards that are not ready for speech out of the speech queue", () => {
    const api = new MockApi(memoryStorage());
    const r = api.addCard({ korean: "TV 보다", meaning: "смотреть телевизор" });
    expect(r.status === "created" && r.card.readyForSpeech).toBe(false);
    expect(api.queue("meaning").some((i) => i.card.korean === "TV 보다")).toBe(false);
    if (r.status === "created") api.introduce(r.card.id);
    expect(api.queue("meaning").some((i) => i.card.korean === "TV 보다")).toBe(true);
    expect(api.queue("speech").some((i) => i.card.korean === "TV 보다")).toBe(false);
  });

  it("offers Hangul cards for listening on a schedule of their own", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    const api = new MockApi(memoryStorage(), () => now);
    const added = api.addCard({ korean: "TV 보다", meaning: "смотреть ТВ" });
    if (added.status === "created") api.introduce(added.card.id);
    const listening = api.queue("listening");
    expect(listening.length).toBeGreaterThan(0);
    expect(listening.some((i) => i.card.korean === "TV 보다")).toBe(false);
    const first = listening[0]!;
    api.review([{ id: "l1", cardId: first.card.id, mode: "listening", rating: "good", reviewedAt: now.toISOString() }]);
    expect(api.queue("listening").some((i) => i.card.id === first.card.id)).toBe(false);
    expect(api.queue("meaning").some((i) => i.card.id === first.card.id)).toBe(true);
  });
});
