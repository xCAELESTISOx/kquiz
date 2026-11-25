import { describe, expect, it } from "vitest";
import { sessionLogs, taskAnswers } from "./db/schema.js";
import { answeredTasks, backfillTaskAnswers } from "./taskStats.js";
import { testApp } from "./testing.js";

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 19, 9, minutes)).toISOString();

function task(n: number, cardId: number, kind: string, result: "right" | "wrong", extra: Record<string, unknown> = {}) {
  return { n, at: at(n), phase: "main", card: { id: cardId, korean: "?", meaning: "?" }, mode: "speech", task: kind, answers: [], result, ...extra };
}

const log = (tasks: Record<string, unknown>[]) => ({ startedAt: at(0), screen: "learn", tasks, events: [] });

describe("answeredTasks", () => {
  it("counts a wrong first try as missed and leaves out mistakes gone over, meetings and unanswered tasks", () => {
    const rows = answeredTasks([
      task(1, 5, "write", "right", { answers: [{ ok: false }, { ok: true }] }),
      task(2, 5, "write", "right", { answers: [{ note: "similar word" }, { ok: true }] }),
      task(3, 5, "say", "wrong"),
      task(4, 5, "intro", "right"),
      task(5, 5, "write", "wrong", { phase: "fix" }),
      { ...task(6, 5, "recall", "right"), result: "skipped" },
      { n: 7, task: "write", result: "right", phase: "main" },
    ]);
    expect(rows.map((r) => [r.n, r.task, r.missed])).toEqual([
      [1, "write", true],
      [2, "write", false],
      [3, "say", true],
    ]);
  });
});

describe("skills and trouble words in GET /stats", () => {
  it("tallies first tries per skill and ranks the words missed most often", async () => {
    const t = testApp();
    await t.signIn();
    const ids: number[] = [];
    for (const korean of ["물", "불", "꽃"]) ids.push((await t.request("/cards", { body: { korean, meaning: `м-${korean}` } })).json.card.id);
    const [water, fire, flower] = ids as [number, number, number];
    const tasks = [
      task(1, water, "write", "wrong"),
      task(2, water, "dictation", "right", { answers: [{ ok: false }, { ok: true }] }),
      task(3, water, "write", "right", { answers: [{ ok: true }] }),
      task(4, fire, "say", "wrong"),
      task(5, fire, "choice", "right"),
      task(6, flower, "recall", "right"),
      task(7, flower, "cloze", "right"),
    ];
    // Saved twice as the session grows: the second save replaces the first.
    await t.request("/session-logs/ABC234", { method: "PUT", body: log(tasks.slice(0, 2)) });
    await t.request("/session-logs/ABC234", { method: "PUT", body: log(tasks) });

    const stats = (await t.request("/stats")).json;
    expect(stats.skills).toEqual([
      { skill: "recall", answers: 2, missed: 0, recent: { answers: 2, missed: 0 } },
      { skill: "choose", answers: 1, missed: 0, recent: { answers: 1, missed: 0 } },
      { skill: "write", answers: 2, missed: 1, recent: { answers: 2, missed: 1 } },
      { skill: "dictation", answers: 1, missed: 1, recent: { answers: 1, missed: 1 } },
      { skill: "speak", answers: 1, missed: 1, recent: { answers: 1, missed: 1 } },
    ]);
    expect(stats.trouble).toEqual([
      { card: { id: water, korean: "물", meaning: "м-물" }, answers: 3, missed: 2, skills: ["write", "dictation"] },
      { card: { id: fire, korean: "불", meaning: "м-불" }, answers: 2, missed: 1, skills: ["speak"] },
    ]);

    // Answers outlive the log, and a deleted card takes its answers with it.
    t.db.delete(sessionLogs).run();
    expect((await t.request(`/cards/${fire}`, { method: "DELETE" })).status).toBeLessThan(500);
    const after = (await t.request("/stats")).json;
    expect(after.trouble[0].card.id).toBe(water);
  });

  it("fills in answers from logs saved before the table existed, once", async () => {
    const t = testApp();
    await t.signIn();
    const id = (await t.request("/cards", { body: { korean: "물", meaning: "вода" } })).json.card.id;
    await t.request("/session-logs/ABC234", { method: "PUT", body: log([task(1, id, "write", "wrong")]) });
    t.db.delete(taskAnswers).run();
    expect(backfillTaskAnswers(t.db)).toBe(1);
    expect(backfillTaskAnswers(t.db)).toBe(0);
    expect(t.db.select().from(taskAnswers).all()).toEqual([expect.objectContaining({ logId: "ABC234", cardId: id, missed: true })]);
  });
});
