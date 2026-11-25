import { describe, expect, it } from "vitest";
import { testApp } from "./testing.js";
import { scoreAnswers, type Answer } from "./wordScore.js";

const DAY = 86_400_000;
const start = Date.UTC(2026, 9, 19, 9);

/** Answers of one session `day` days in, in order. */
function session(day: number, ...tasks: (string | [string, Partial<Answer>])[]): Answer[] {
  return tasks.map((t, i) => {
    const [task, more] = typeof t === "string" ? [t, {}] : t;
    return { logId: `S${day}`, n: i + 1, task, phase: "main", missed: false, soft: false, recovered: false, answeredAt: new Date(start + day * DAY + i * 60_000), ...more };
  });
}
const miss = { missed: true };
const fix = { phase: "fix" as const };

describe("scoreAnswers", () => {
  it("earns by how hard the task is, half with a hint and in extra practice", () => {
    expect(scoreAnswers(session(0, "choose")).score).toBe(1);
    expect(scoreAnswers(session(0, "listen")).score).toBe(2);
    expect(scoreAnswers(session(0, "write")).score).toBe(3);
    expect(scoreAnswers(session(0, ["write", { soft: true }])).score).toBe(1.5);
    expect(scoreAnswers(session(0, ["write", { phase: "extra" }])).score).toBe(1.5);
  });

  it("costs more for a miss than any task earns", () => {
    const before = scoreAnswers([...session(0, "write", "say"), ...session(1, "dictation")]).score;
    const after = scoreAnswers([...session(0, "write", "say"), ...session(1, "dictation"), ...session(2, ["choose", miss], "write")]).score;
    expect(before).toBe(9);
    expect(after).toBeLessThan(before);
  });

  it("gives back at most half of a miss in the same session, going over mistakes or not", () => {
    const base = [...session(0, "write", "say"), ...session(1, "dictation", "listen")];
    expect(scoreAnswers(base).score).toBe(11);
    const missed = scoreAnswers([...base, ...session(2, ["write", miss], "say", "listen", ["write", fix], ["write", fix])]);
    // 11 − 4, then +1 and +1 (half of 4), then nothing.
    expect(missed.score).toBe(9);
    // "After a try": −4, +1 for putting it right.
    expect(scoreAnswers([...base, ...session(2, ["write", { missed: true, recovered: true }])]).score).toBe(8);
  });

  it("caps what a session earns and what it costs", () => {
    expect(scoreAnswers(session(0, "write", "write", "write", "write")).score).toBe(6);
    const base = [...session(0, "write", "say"), ...session(1, "write", "say")];
    expect(scoreAnswers([...base, ...session(2, ["write", miss], ["say", miss], ["listen", miss])]).score).toBe(12 - 8);
  });

  it("adds a point for remembering after a week unseen", () => {
    expect(scoreAnswers([...session(0, "listen"), ...session(8, "listen")]).score).toBe(5);
  });

  it("never turns a word missed today green, however it goes after", () => {
    const strong = [...session(0, "write", "say", "listen"), ...session(1, "write", "recall", "listen"), ...session(3, "dictation", "recall", "say")];
    const good = scoreAnswers(strong, { ways: ["meaning", "say", "ear"] });
    expect(good.score).toBe(18);
    expect(good.level).toBe("solid");
    const today = scoreAnswers([...strong, ...session(5, ["listen", miss], ["listen", fix])], { ways: ["meaning", "say", "ear"] });
    expect(today.level).toBe("familiar");
    expect(today.last.ear).toBe("missed");
    // A clean session after it, with the word heard right again, and it is green again.
    const later = scoreAnswers([...strong, ...session(5, ["listen", miss]), ...session(6, "listen", "write")], { ways: ["meaning", "say", "ear"] });
    expect(later.score).toBe(18 - 4 + 2 + 3);
    expect(later.level).toBe("solid");
  });

  it("asks for every way a word is reviewed before calling it known", () => {
    const sayOnly = [...session(0, "write", "say"), ...session(1, "write", "say"), ...session(2, "write", "say")];
    expect(scoreAnswers(sayOnly, { ways: ["say", "ear"] }).level).toBe("familiar");
    expect(scoreAnswers(sayOnly, { ways: ["say"] }).level).toBe("solid");
  });

  it("keeps a word still on its ladder at learning", () => {
    expect(scoreAnswers([...session(0, "write", "say"), ...session(1, "write", "say")], { learned: false }).level).toBe("learning");
    expect(scoreAnswers([]).level).toBe("new");
  });
});

describe("GET /reviews/word-scores and levels in GET /stats", () => {
  it("scores the user's words from the session logs", async () => {
    const t = testApp();
    await t.signIn();
    const water = (await t.request("/cards", { body: { korean: "물", meaning: "вода" } })).json.card.id as number;
    const fire = (await t.request("/cards", { body: { korean: "불", meaning: "огонь" } })).json.card.id as number;
    const at = (m: number) => new Date(Date.UTC(2026, 9, 19, 9, m)).toISOString();
    const task = (n: number, id: number, kind: string, result: string, more: Record<string, unknown> = {}) => ({
      n,
      at: at(n),
      phase: "main",
      card: { id, korean: "?", meaning: "?" },
      mode: "speech",
      task: kind,
      answers: [],
      result,
      ...more,
    });
    const res = await t.request("/session-logs/ABCDEF", {
      method: "PUT",
      body: {
        startedAt: at(0),
        screen: "learn",
        tasks: [task(1, water, "write", "right"), task(2, fire, "write", "right"), task(3, fire, "listen", "wrong"), task(4, fire, "listen", "right", { phase: "fix" })],
        events: [],
      },
    });
    expect(res.status).toBe(200);
    const { scores } = (await t.request("/reviews/word-scores")).json;
    expect(scores[water]).toMatchObject({ score: 3, level: "learning", answers: 1 });
    expect(scores[fire]).toMatchObject({ score: 1, last: { say: "right", ear: "missed" } });
    const one = (await t.request(`/reviews/word-scores?cardIds=${water}`)).json.scores;
    expect(Object.keys(one)).toEqual([String(water)]);
    const stats = (await t.request("/stats")).json;
    expect(stats.levels).toMatchObject({ learning: 2, new: 0 });
  });
});
