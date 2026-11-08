import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recordAttempt } from "./attemptStore.js";
import type { ScoreResult } from "./scorer.js";
import { ACTIVITY_DAYS, FORECAST_DAYS, streaks, zoneOffset } from "./statsStore.js";
import { testApp } from "./testing.js";
import { OWNER_ID } from "./users.js";

const DAY = 86_400_000;

function attempt(score: number, wrongCoda: boolean): ScoreResult {
  return {
    score,
    text: "국물",
    pronunciation: "궁물",
    syllables: [],
    errors: wrongCoda
      ? [{ syllable: 0, position: "coda", kind: "substitution", status: "wrong", expected: { ipa: "ŋ", jamo: "ㅇ" }, heard: null }]
      : [],
    target_phones: ["k", "u", "ŋ", "m", "u", "l"],
    heard_phones: [],
  };
}

describe("streaks", () => {
  it("counts the current run from today or yesterday and the longest run", () => {
    expect(streaks([], 100)).toEqual({ current: 0, best: 0 });
    expect(streaks([99, 98, 97, 90, 89, 88, 87], 100)).toEqual({ current: 3, best: 4 });
    expect(streaks([100, 99], 100)).toEqual({ current: 2, best: 2 });
    expect(streaks([98, 97], 100)).toEqual({ current: 0, best: 2 });
  });
});

describe("zoneOffset", () => {
  it("gives minutes east of UTC", () => {
    expect(zoneOffset("Asia/Seoul")).toBe(540);
    expect(zoneOffset("UTC")).toBe(0);
    expect(zoneOffset("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(-300);
  });
});

describe("GET /stats", () => {
  it("requires a session and a sane time zone", async () => {
    const t = testApp();
    expect((await t.request("/stats")).status).toBe(401);
    await t.signIn();
    expect((await t.request("/stats?tz=9999")).status).toBe(400);
  });

  it("reports streak, activity, forecast, retention and card states in the owner's days", async () => {
    const t = testApp();
    await t.signIn();
    const start = new Date("2026-10-15T01:00:00Z"); // 10:00 in Seoul
    t.clock.now = start;
    const card = (await t.request("/cards", { body: { korean: "국물", meaning: "бульон" } })).json.card;
    await t.request("/cards", { body: { korean: "물", meaning: "вода" } });

    const review = async (at: Date, rating: string, mode = "meaning") => {
      t.clock.now = at;
      const res = await t.request("/reviews", {
        body: { reviews: [{ id: randomUUID(), cardId: card.id, mode, rating, reviewedAt: at.toISOString() }] },
      });
      expect(res.json.results[0].status).toBe("applied");
    };
    // First sighting, a learning step 10 minutes later, then real recalls on later days.
    await review(start, "good");
    await review(new Date(start.getTime() + 10 * 60_000), "good");
    await review(new Date(start.getTime() + 2 * DAY), "again");
    await review(new Date(start.getTime() + 3 * DAY), "good");
    await review(new Date(start.getTime() + 3 * DAY), "good", "speech");

    t.clock.now = new Date("2026-10-18T16:00:00Z"); // 01:00 on the 19th in Seoul, the 18th in UTC
    const seoul = (await t.request("/stats?tz=540")).json;
    expect(seoul.today).toBe("2026-10-19");
    expect(seoul.streak).toEqual({ current: 2, best: 2, reviewedToday: false });
    const utc = (await t.request("/stats?tz=0")).json;
    expect(utc.today).toBe("2026-10-18");
    expect(utc.streak).toMatchObject({ current: 2, reviewedToday: true });

    expect(seoul.activity).toHaveLength(ACTIVITY_DAYS);
    expect(seoul.activity.at(-1)).toEqual({ day: "2026-10-19", reviews: 0 });
    expect(seoul.activity.at(-2)).toEqual({ day: "2026-10-18", reviews: 2 });
    expect(seoul.activity.at(-5)).toEqual({ day: "2026-10-15", reviews: 2 });

    expect(seoul.forecast).toHaveLength(FORECAST_DAYS);
    const meaningDue = seoul.forecast.reduce((n: number, f: { due: Record<string, number> }) => n + f.due.meaning, 0);
    // 물 went into reviews unreviewed (as a word just learned does): it is due too, overdue today.
    expect(meaningDue).toBe(2);
    expect(seoul.forecast[0].due).toHaveProperty("speech");
    expect(seoul.forecast[0].words).toBeGreaterThanOrEqual(1);
    expect(seoul.learned).toBe(2);
    expect(seoul.learning).toBe(0);

    expect(seoul.retention.meaning).toEqual({ reviews: 2, recalled: 1 });
    expect(seoul.retention.speech).toEqual({ reviews: 0, recalled: 0 });
    expect(seoul.cards.total).toBe(2);
    expect(seoul.cards.byMode.meaning.new).toBe(1);
    expect(seoul.cards.byMode.speech.new).toBe(1);
    expect(seoul.cards.byMode.meaning.young + seoul.cards.byMode.meaning.learning).toBe(1);
  });

  it("leaves paused cards out of the forecast and card states", async () => {
    const t = testApp();
    await t.signIn();
    const card = (await t.request("/cards", { body: { korean: "물", meaning: "вода" } })).json.card;
    expect((await t.request("/stats")).json.cards.byMode.meaning.new).toBe(1);
    expect((await t.request(`/cards/${card.id}`, { method: "PATCH", body: { suspended: true } })).status).toBe(200);
    expect((await t.request("/stats")).json.cards.byMode.meaning).toBeUndefined();
  });

  it("shows weekly pronunciation scores and the trend of weak sounds", async () => {
    const t = testApp();
    await t.signIn();
    const card = (await t.request("/cards", { body: { korean: "국물", meaning: "бульон" } })).json.card;
    const now = t.clock.now.getTime();
    // Two weeks ago the coda was always wrong; this week only once in three.
    for (const age of [20, 19, 18]) recordAttempt(t.db, OWNER_ID, card.id, attempt(60, true), new Date(now - age * DAY));
    for (const [age, wrong] of [[2, true], [1, false], [0, false]] as const) {
      recordAttempt(t.db, OWNER_ID, card.id, attempt(wrong ? 70 : 90, wrong), new Date(now - age * DAY));
    }
    const { speech } = (await t.request("/stats")).json;
    expect(speech.weeks).toHaveLength(8);
    expect(speech.weeks.at(-1)).toMatchObject({ attempts: 3, avgScore: 83 });
    expect(speech.weeks.slice(0, -1).reduce((n: number, w: { attempts: number }) => n + w.attempts, 0)).toBe(3);
    expect(speech.sounds).toEqual([
      { phone: "ŋ", attempts: 6, errors: 4, recent: { attempts: 3, errors: 1 }, previous: { attempts: 3, errors: 3 } },
    ]);
  });
});

describe("MCP get_stats data", () => {
  it("adds next week's load and retention", async () => {
    const { SqliteCardStore } = await import("./storage/mcp.js");
    const t = testApp();
    await t.signIn();
    await t.request("/cards", { body: { korean: "물", meaning: "вода" } });
    const stats = await new SqliteCardStore(t.db, OWNER_ID).stats(t.clock.now);
    // In reviews but never reviewed, like a word just learned: its first review is in the week's load.
    expect(stats).toMatchObject({ cards: 1, dueNext7Days: { meaning: 1, speech: 1 }, retention30d: { meaning: null, speech: null } });
  });
});
