import { describe, expect, it } from "vitest";
import { users } from "./db/schema.js";
import { KEEP_LOGS, listSessionLogs, recentSessionLogs, sessionLog } from "./sessionLogs.js";
import { testApp } from "./testing.js";

const log = (startedAt: string, tasks: Record<string, unknown>[] = []) => ({
  startedAt,
  screen: "learn",
  tasks,
  events: [{ at: startedAt, what: "start" }],
});

describe("session logs", () => {
  it("keeps the log of a session, updated as it grows, for the user only", async () => {
    const t = testApp();
    await t.signIn();
    const first = await t.request("/session-logs/ABC234", { method: "PUT", body: log("2026-11-09T05:00:00.000Z") });
    expect(first.status).toBe(200);
    const task = { n: 1, card: { id: 1, korean: "물", meaning: "вода" }, task: "write", answers: [{ given: "뭄" }], result: "wrong" };
    await t.request("/session-logs/ABC234", { method: "PUT", body: log("2026-11-09T05:00:00.000Z", [task]) });

    expect(sessionLog(t.db, 1, "abc234 ")).toMatchObject({ id: "ABC234", screen: "learn", tasks: [task] });
    expect(listSessionLogs(t.db, 1, 10)).toEqual([expect.objectContaining({ id: "ABC234", tasks: 1, mistakes: 1 })]);

    // Someone else's id is not taken over, and they don't see this one.
    t.db.insert(users).values({ name: "Миша", role: "member", webauthnId: "m", createdAt: new Date() }).run();
    expect(sessionLog(t.db, 2, "ABC234")).toBeUndefined();
  });

  it("rejects bad ids and needs a session", async () => {
    const t = testApp();
    expect((await t.request("/session-logs/ABC234", { method: "PUT", body: log("2026-11-09T05:00:00.000Z") })).status).toBe(401);
    await t.signIn();
    expect((await t.request("/session-logs/abc", { method: "PUT", body: log("2026-11-09T05:00:00.000Z") })).status).toBe(400);
    expect((await t.request("/session-logs/ABC234", { method: "PUT", body: { tasks: [] } })).status).toBe(400);
  });

  it(`keeps the latest ${KEEP_LOGS} sessions`, async () => {
    const t = testApp();
    await t.signIn();
    const abc = "23456789ABCDEFGH";
    const ids = Array.from({ length: KEEP_LOGS + 2 }, (_, i) => `AAAA${abc[i >> 4]}${abc[i & 15]}`);
    for (const [i, id] of ids.entries()) {
      const res = await t.request(`/session-logs/${id}`, { method: "PUT", body: log(new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString()) });
      expect(res.status).toBe(200);
    }
    const kept = recentSessionLogs(t.db, 1, 100);
    expect(kept).toHaveLength(KEEP_LOGS);
    expect(kept[0]!.id).toBe(ids.at(-1));
    expect(recentSessionLogs(t.db, 1, 1, 1)[0]!.id).toBe(ids.at(-2));
  });
});
