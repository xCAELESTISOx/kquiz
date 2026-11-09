import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { path: string; body: { tasks: Record<string, unknown>[]; events: { what: string }[] } }[] = [];
vi.mock("./api", () => ({
  request: async (_method: string, path: string, opts: { body: (typeof sent)[number]["body"] }) => {
    sent.push({ path, body: structuredClone(opts.body) });
    return { ok: true };
  },
}));

const { endLog, flushLog, logAnswer, logOutcome, logServer, logShown, startLog } = await import("./sessionLog");
import type { Card, QueueItem } from "./types";

const item = (id: number, learn?: QueueItem["learn"]): QueueItem => ({
  card: { id, korean: `단어${id}`, meaning: `слово ${id}` } as Card,
  mode: "speech",
  due: "",
  state: 0,
  reps: 1,
  lapses: 0,
  ...(learn ? { learn } : {}),
});

describe("session log", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("logs each task with what was given and how it ended, and sends it under the session's id", async () => {
    const id = startLog("learn");
    expect(id).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    const word = item(1, { kind: "write" });
    logShown(1, word, "write", "main");
    logShown(1, word, "write", "main");
    logAnswer({ given: "단어", expected: "단어1", ok: false });
    const n = logOutcome({ ok: false });
    logShown(2, item(2), "choice", "main");
    // The server's answer comes once the next task is on screen.
    logServer(n, "missed step 1");
    logOutcome({ rating: "good" });
    // The same word again later is a task of its own.
    logShown(3, word, "write", "fix");
    endLog();
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    const { path, body } = sent[0]!;
    expect(path).toBe(`/session-logs/${id}`);
    expect(body.tasks).toEqual([
      expect.objectContaining({ n: 1, task: "write", learn: "write", answers: [{ given: "단어", expected: "단어1", ok: false }], result: "wrong", server: "missed step 1" }),
      expect.objectContaining({ n: 2, task: "choice", result: "right", rating: "good" }),
      expect.objectContaining({ n: 3, phase: "fix", result: "skipped" }),
    ]);
    expect(body.events.map((e) => e.what)).toEqual(["start", "left"]);
  });

  it("doesn't keep a session left before its first answer, unless its id was asked for", async () => {
    startLog("learn");
    await flushLog();
    expect(sent).toHaveLength(0);
    await flushLog(true);
    expect(sent).toHaveLength(1);
    endLog();
  });
});
