import { describe, expect, it } from "vitest";
import { phoneStats } from "./db/schema.js";
import { httpScorer, ScorerError, type Scorer, type ScoreResult } from "./scorer.js";
import { testApp } from "./testing.js";

/** A minimal WAV header with no samples; the fake scorer never looks inside. */
function wav(bytes = 44): Uint8Array {
  const data = new Uint8Array(bytes);
  data.set(new TextEncoder().encode("RIFF"), 0);
  data.set(new TextEncoder().encode("WAVE"), 8);
  return data;
}

const 국물: ScoreResult = {
  score: 70,
  text: "국물",
  pronunciation: "궁물",
  syllables: [
    { text: "국", pron: "궁", status: "wrong" },
    { text: "물", pron: "물", status: "ok" },
  ],
  errors: [
    {
      syllable: 0,
      position: "coda",
      kind: "substitution",
      status: "wrong",
      expected: { ipa: "ŋ", jamo: "ㅇ" },
      heard: { ipa: "k", jamo: "ㄱ" },
    },
  ],
  target_phones: ["k", "u", "ŋ", "m", "u", "l"],
  heard_phones: ["k", "u", "k", "m", "u", "l"],
};

function fakeScorer(result: ScoreResult | ScorerError = 국물) {
  const calls: { text: string; size: number }[] = [];
  const scorer: Scorer = {
    async score(audio, text) {
      calls.push({ text, size: audio.byteLength });
      if (result instanceof ScorerError) throw result;
      return result;
    },
  };
  return { scorer, calls };
}

async function withCard(scorer: Scorer, korean = "국물") {
  const t = testApp({}, { scorer });
  await t.signIn();
  const card = (await t.request("/cards", { body: { korean, meaning: "бульон" } })).json.card;
  return { ...t, card };
}

describe("score", () => {
  it("requires a session and the CSRF token", async () => {
    const { scorer } = fakeScorer();
    const t = testApp({}, { scorer });
    expect((await t.request("/score?cardId=1", { body: wav() })).status).toBe(401);
    await t.signIn();
    expect((await t.request("/score?cardId=1", { body: wav(), headers: { "x-csrf-token": "x" } })).status).toBe(403);
  });

  it("forwards the recording with the card's text and suggests a rating", async () => {
    const { scorer, calls } = fakeScorer();
    const t = await withCard(scorer);
    const res = await t.request(`/score?cardId=${t.card.id}`, { body: wav(1000) });
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ text: "국물", size: 1000 }]);
    expect(res.json).toMatchObject({
      cardId: t.card.id,
      score: 70,
      pronunciation: "궁물",
      syllables: 국물.syllables,
      errors: 국물.errors,
      suggestedRating: "hard",
    });
    expect(res.json.attemptId).toBeTypeOf("number");
  });

  it("counts wrong sounds, not weak ones, in the weak-sounds stats", async () => {
    const weak: ScoreResult = {
      ...국물,
      score: 85,
      syllables: [{ ...국물.syllables[0]!, status: "weak" }, 국물.syllables[1]!],
      errors: [{ ...국물.errors[0]!, status: "weak" }],
    };
    const t = await withCard(fakeScorer(weak).scorer);
    expect((await t.request(`/score?cardId=${t.card.id}`, { body: wav() })).json.suggestedRating).toBe("good");
    const stats = Object.fromEntries(t.db.select().from(phoneStats).all().map((r) => [r.phone, [r.attempts, r.errors]]));
    expect(stats).toEqual({ k: [1, 0], u: [2, 0], ŋ: [1, 0], m: [1, 0], l: [1, 0] });
  });

  it("records errors for wrong sounds", async () => {
    const t = await withCard(fakeScorer().scorer);
    await t.request(`/score?cardId=${t.card.id}`, { body: wav() });
    await t.request(`/score?cardId=${t.card.id}`, { body: wav() });
    const ŋ = t.db.select().from(phoneStats).all().find((r) => r.phone === "ŋ");
    expect(ŋ).toMatchObject({ attempts: 2, errors: 2 });
  });

  it("rejects unknown cards, non-Hangul cards and non-WAV bodies before calling the scorer", async () => {
    const { scorer, calls } = fakeScorer();
    const t = await withCard(scorer);
    expect((await t.request("/score?cardId=999", { body: wav() })).status).toBe(404);
    expect((await t.request("/score", { body: wav() })).status).toBe(400);
    const tv = (await t.request("/cards", { body: { korean: "TV 보다", meaning: "смотреть ТВ" } })).json.card;
    expect((await t.request(`/score?cardId=${tv.id}`, { body: wav() })).json.error).toBe("not_ready_for_speech");
    const notWav = await t.request(`/score?cardId=${t.card.id}`, { body: new Uint8Array(100) });
    expect(notWav.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("refuses recordings over 1 MB", async () => {
    const t = await withCard(fakeScorer().scorer);
    expect((await t.request(`/score?cardId=${t.card.id}`, { body: wav(1_100_000) })).status).toBe(413);
  });

  it("explains scorer failures", async () => {
    for (const [reason, status] of [
      ["bad_recording", 422],
      ["busy", 503],
      ["timeout", 504],
      ["unavailable", 503],
    ] as const) {
      const t = await withCard(fakeScorer(new ScorerError(reason, "x")).scorer);
      const res = await t.request(`/score?cardId=${t.card.id}`, { body: wav() });
      expect([res.status, res.json.error]).toEqual([status, reason]);
    }
  });

  it("limits scoring to 20 recordings a minute", async () => {
    const t = await withCard(fakeScorer().scorer);
    for (let i = 0; i < 20; i++) expect((await t.request(`/score?cardId=${t.card.id}`, { body: wav() })).status).toBe(200);
    expect((await t.request(`/score?cardId=${t.card.id}`, { body: wav() })).status).toBe(429);
    t.clock.now = new Date(t.clock.now.getTime() + 61_000);
    expect((await t.request(`/score?cardId=${t.card.id}`, { body: wav() })).status).toBe(200);
  });
});

describe("httpScorer", () => {
  const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it("posts WAV to /score with the text", async () => {
    let seen: { url: string; type: string | null } | undefined;
    const scorer = httpScorer("http://127.0.0.1:8788", (async (url: string, init: RequestInit) => {
      seen = { url, type: new Headers(init.headers).get("content-type") };
      return new Response(JSON.stringify(국물));
    }) as typeof fetch);
    expect((await scorer.score(wav(), "국물")).score).toBe(70);
    expect(seen).toEqual({ url: "http://127.0.0.1:8788/score?text=%EA%B5%AD%EB%AC%BC", type: "audio/wav" });
  });

  it("maps scorer statuses to reasons", async () => {
    const cases: [number, unknown, string][] = [
      [422, { detail: "no speech" }, "bad_recording"],
      [413, { detail: "too big" }, "bad_recording"],
      [503, { detail: "scorer is busy" }, "busy"],
      [503, { detail: "model is not loaded" }, "unavailable"],
      [504, { detail: "scoring timed out" }, "timeout"],
      [500, "oops", "unavailable"],
    ];
    for (const [status, body, reason] of cases) {
      const error = await httpScorer("http://s", respond(status, body) as unknown as typeof fetch)
        .score(wav(), "물")
        .catch((e: unknown) => e);
      expect((error as ScorerError).reason).toBe(reason);
    }
    const down = await httpScorer("http://s", (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch)
      .score(wav(), "물")
      .catch((e: unknown) => e);
    expect((down as ScorerError).reason).toBe("unavailable");
  });
});
