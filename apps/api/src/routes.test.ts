import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { saveCardAudio } from "./cardAudio.js";
import { testApp } from "./testing.js";

async function signedIn() {
  const t = testApp();
  await t.signIn();
  return t;
}

describe("cards", () => {
  it("answers health checks without a session", async () => {
    const { request } = testApp();
    expect((await request("/health")).json).toEqual({ ok: true });
  });

  it("requires a session", async () => {
    const { request } = testApp();
    expect((await request("/cards")).status).toBe(401);
    expect((await request("/cards", { body: { korean: "물", meaning: "вода" } })).status).toBe(401);
    expect((await request("/reviews/queue?mode=meaning")).status).toBe(401);
  });

  it("requires the CSRF token on changes", async () => {
    const t = await signedIn();
    const res = await t.request("/cards", { body: { korean: "물", meaning: "вода" }, headers: { "x-csrf-token": "x" } });
    expect(res.status).toBe(403);
  });

  it("creates a card and rejects a duplicate that differs only in spacing or punctuation", async () => {
    const t = await signedIn();
    const res = await t.request("/cards", { body: { korean: " 감사 합니다 ", meaning: "спасибо", tags: ["вежливость"] } });
    expect(res.status).toBe(201);
    expect(res.json.card).toMatchObject({ korean: "감사 합니다", speakable: true, readyForSpeech: true, source: "app" });
    const dup = await t.request("/cards", { body: { korean: "감사합니다!", meaning: "спасибо" } });
    expect(dup.status).toBe(409);
    expect(dup.json.existingId).toBe(res.json.card.id);
  });

  it("marks non-Hangul cards as not ready and keeps them out of speech", async () => {
    const t = await signedIn();
    const res = await t.request("/cards", { body: { korean: "TV 보다", meaning: "смотреть ТВ", speakable: true } });
    expect(res.json.card).toMatchObject({ speakable: false, readyForSpeech: false });
    expect((await t.request("/cards?notReady=1")).json.cards).toHaveLength(1);
    expect((await t.request("/reviews/queue?mode=speech")).json.items).toHaveLength(0);
    expect((await t.request("/reviews/queue?mode=meaning")).json.items).toHaveLength(1);
  });

  it("adds cards in bulk from text and from objects", async () => {
    const t = await signedIn();
    const text = await t.request("/cards/bulk", { body: { text: "물 — вода\n불 - огонь\nбез разделителя\n물 — вода" } });
    expect(text.json.created).toHaveLength(2);
    expect(text.json.duplicates).toEqual([{ korean: "물", existingId: text.json.created[0].id }]);
    expect(text.json.rejected).toEqual([{ input: "без разделителя", reason: "unparsed_line" }]);
    const objects = await t.request("/cards/bulk", { body: { cards: [{ korean: "하늘", meaning: "небо" }, { korean: "" }] } });
    expect(objects.json.created).toHaveLength(1);
    expect(objects.json.rejected).toHaveLength(1);
    expect(objects.json.created[0].source).toBe("bulk");
  });

  it("caps a bulk batch at 50 cards", async () => {
    const t = await signedIn();
    const lines = Array.from({ length: 51 }, (_, i) => `단어${String.fromCharCode(0xac00 + i)} — слово ${i}`).join("\n");
    expect((await t.request("/cards/bulk", { body: { text: lines } })).status).toBe(400);
  });

  it("searches, filters by tag and pages", async () => {
    const t = await signedIn();
    await t.request("/cards/bulk", {
      body: { cards: [{ korean: "사과", meaning: "яблоко", tags: ["еда"] }, { korean: "배", meaning: "груша", tags: ["еда"] }, { korean: "책", meaning: "книга" }] },
    });
    expect((await t.request("/cards?q=" + encodeURIComponent("ГРУШ"))).json.cards.map((c: any) => c.korean)).toEqual(["배"]);
    expect((await t.request("/cards?tag=" + encodeURIComponent("еда"))).json.cards).toHaveLength(2);
    const first = await t.request("/cards?limit=2");
    expect(first.json.cards.map((c: any) => c.korean)).toEqual(["책", "배"]);
    const second = await t.request(`/cards?limit=2&before=${first.json.nextBefore}`);
    expect(second.json).toMatchObject({ cards: [{ korean: "사과" }], nextBefore: null });
  });

  it("treats % in a search as a literal", async () => {
    const t = await signedIn();
    await t.request("/cards", { body: { korean: "물", meaning: "вода" } });
    expect((await t.request("/cards?q=%25")).json.cards).toHaveLength(0);
  });

  it("updates and deletes a card", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards", { body: { korean: "물", meaning: "вода", notes: "x" } });
    const id = json.card.id;
    const patched = await t.request(`/cards/${id}`, { method: "PATCH", body: { meaning: "вода (питьевая)", notes: "" } });
    expect(patched.json.card).toMatchObject({ meaning: "вода (питьевая)", notes: null, korean: "물" });
    await t.request("/cards", { body: { korean: "불", meaning: "огонь" } });
    expect((await t.request(`/cards/${id}`, { method: "PATCH", body: { korean: "불" } })).status).toBe(409);
    expect((await t.request(`/cards/${id}`, { method: "PATCH", body: {} })).status).toBe(400);
    expect((await t.request(`/cards/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await t.request(`/cards/${id}`)).status).toBe(404);
  });
});

describe("word families", () => {
  const 學 = { ko: "학", hanja: "學", meaning: "учёба" };
  const 校 = { ko: "교", hanja: "校", meaning: "школа" };
  const 生 = { ko: "생", hanja: "生", meaning: "жизнь" };
  const 數 = { ko: "수", hanja: "數", meaning: "число" };
  const 水 = { ko: "수", hanja: "水", meaning: "вода" };

  it("links cards that share a hanja, not just a syllable", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards/bulk", {
      body: {
        cards: [
          { korean: "학교", meaning: "школа", roots: [學, 校] },
          { korean: "학생", meaning: "студент", roots: [學, 生] },
          { korean: "수학", meaning: "математика", roots: [數, 學] },
          { korean: "수영", meaning: "плавание", roots: [水, { ko: "영", hanja: "泳", meaning: "плавать" }] },
          { korean: "사랑", meaning: "любовь", roots: [] },
          { korean: "책", meaning: "книга" },
        ],
      },
    });
    const [school, , math] = json.created;
    expect(school.roots).toEqual([學, 校]);
    expect(json.created[5].roots).toBeNull();

    const family = await t.request(`/cards/${school.id}/family`);
    expect(family.json.families.map((f: any) => [f.hanja, f.total, f.cards.map((c: any) => c.korean)])).toEqual([
      ["學", 2, ["수학", "학생"]],
      ["校", 0, []],
    ]);
    // 수 數 in 수학 and 수 水 in 수영 are different roots.
    expect((await t.request(`/cards/${math.id}/family`)).json.families[0]).toMatchObject({ hanja: "數", total: 0 });
    expect((await t.request("/cards/999/family")).status).toBe(404);

    expect((await t.request("/cards?root=" + encodeURIComponent("學"))).json.cards).toHaveLength(3);
    const group = await t.request("/reviews/group", { body: { mode: "meaning", root: "學" } });
    expect(group.json.total).toBe(3);
  });

  it("keeps roots on other edits and rejects malformed ones", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards", { body: { korean: "학교", meaning: "школа", roots: [學, 校] } });
    const patched = await t.request(`/cards/${json.card.id}`, { method: "PATCH", body: { meaning: "школа!" } });
    expect(patched.json.card.roots).toEqual([學, 校]);
    const bad = await t.request("/cards", { body: { korean: "학생", meaning: "студент", roots: [{ ko: "학", hanja: "x", meaning: "учёба" }] } });
    expect(bad.status).toBe(400);
  });
});

describe("reviews", () => {
  it("schedules each mode separately and applies a review once", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards", { body: { korean: "물", meaning: "вода" } });
    const review = { id: randomUUID(), cardId: json.card.id, mode: "meaning", rating: "easy", reviewedAt: t.clock.now.toISOString() };
    const first = await t.request("/reviews", { body: { reviews: [review, review] } });
    expect(first.json.results.map((r: any) => r.status)).toEqual(["applied", "duplicate"]);
    const resent = await t.request("/reviews", { body: { reviews: [review] } });
    expect(resent.json.results[0].status).toBe("duplicate");
    expect((await t.request("/reviews/queue?mode=meaning")).json.items).toHaveLength(0);
    expect((await t.request("/reviews/queue?mode=speech")).json.items).toHaveLength(1);
    expect((await t.request("/reviews/stats")).json).toEqual({ cards: 1, due: { meaning: 0, speech: 1, listening: 0 }, reviewedToday: 1, newCards: { introduced: 0, limit: 15, queued: 0 } });
  });

  it("offers a card for listening once its recording is made from its current Korean", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards", { body: { korean: "물", meaning: "вода" } });
    const listening = async () => (await t.request("/reviews/queue?mode=listening")).json.items;
    expect(await listening()).toHaveLength(0);
    saveCardAudio(t.db, json.card.id, "물", new Uint8Array([1]), t.clock.now);
    expect(await listening()).toHaveLength(1);
    expect((await t.request("/reviews/stats")).json.due.listening).toBe(1);

    const review = { id: randomUUID(), cardId: json.card.id, mode: "listening", rating: "good", reviewedAt: t.clock.now.toISOString() };
    expect((await t.request("/reviews", { body: { reviews: [review] } })).json.results[0].status).toBe("applied");
    expect(await listening()).toHaveLength(0);
    // The other modes keep their own schedules.
    expect((await t.request("/reviews/queue?mode=meaning")).json.items).toHaveLength(1);

    t.clock.now = new Date(t.clock.now.getTime() + 20 * 86_400_000);
    expect(await listening()).toHaveLength(1);
    await t.request(`/cards/${json.card.id}`, { method: "PATCH", body: { korean: "물이" } });
    expect(await listening()).toHaveLength(0);
  });

  it("applies offline reviews in the order they happened", async () => {
    const t = await signedIn();
    const { json } = await t.request("/cards", { body: { korean: "물", meaning: "вода" } });
    const at = (minutes: number) => new Date(t.clock.now.getTime() - minutes * 60_000).toISOString();
    const late = { id: randomUUID(), cardId: json.card.id, mode: "meaning", rating: "good", reviewedAt: at(1) };
    const early = { id: randomUUID(), cardId: json.card.id, mode: "meaning", rating: "again", reviewedAt: at(30) };
    const res = await t.request("/reviews", { body: { reviews: [late, early] } });
    expect(res.json.results.map((r: any) => [r.id, r.status])).toEqual([
      [late.id, "applied"],
      [early.id, "applied"],
    ]);
  });

  it("reports reviews for missing cards and rejects bad input", async () => {
    const t = await signedIn();
    const missing = { id: randomUUID(), cardId: 999, mode: "meaning", rating: "good", reviewedAt: t.clock.now.toISOString() };
    expect((await t.request("/reviews", { body: { reviews: [missing] } })).json.results[0].status).toBe("card_not_found");
    expect((await t.request("/reviews", { body: { reviews: [{ ...missing, rating: "perfect" }] } })).status).toBe(400);
    expect((await t.request("/reviews", { body: { reviews: [{ ...missing, id: "not-a-uuid" }] } })).status).toBe(400);
  });
});

describe("protection", () => {
  it("rejects requests that bypass Cloudflare", async () => {
    const secret = "s".repeat(40);
    const { request } = testApp({ ORIGIN_SECRET: secret });
    expect((await request("/auth/status")).status).toBe(403);
    expect((await request("/auth/status", { headers: { "x-kquiz-origin": secret } })).status).toBe(403);
    const ok = await request("/auth/status", { headers: { "x-kquiz-origin": secret, "cf-connecting-ip": "203.0.113.1" } });
    expect(ok.status).toBe(200);
  });

  it("rejects cross-site form posts", async () => {
    const { app } = testApp();
    const res = await app.request("/api/auth/login/options", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.test" },
      body: "",
    });
    expect(res.status).toBe(403);
  });

  it("rejects large bodies", async () => {
    const t = await signedIn();
    const res = await t.request("/cards/bulk", { body: { text: "가".repeat(1024 * 1024) } });
    expect(res.status).toBe(413);
  });

  it("refuses to start in production without https or the origin secret", async () => {
    const { loadConfig } = await import("./config.js");
    expect(() => loadConfig({ NODE_ENV: "production", ORIGIN: "http://kquiz.test", ORIGIN_SECRET: "s".repeat(40) })).toThrow();
    expect(() => loadConfig({ NODE_ENV: "production", ORIGIN: "https://kquiz.test" })).toThrow();
  });
});
