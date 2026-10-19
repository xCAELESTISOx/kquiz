import { describe, expect, it } from "vitest";
import { openDb } from "../db/client.js";
import { reviewLog } from "../db/schema.js";
import { phoneStats } from "../db/schema.js";
import { SqliteCardStore, SqliteOAuthStore, streakDays } from "./mcp.js";

const card = (korean: string, meaning: string) => ({ korean, meaning, tags: [] as string[] });

describe("SqliteCardStore", () => {
  it("finds existing cards by normalized Korean, ignoring punctuation", async () => {
    const store = new SqliteCardStore(openDb(":memory:"));
    const [water] = await store.insert([card("물", "вода")], "claude");
    expect(water).toMatchObject({ id: expect.any(String), korean: "물", source: "claude", speakable: true });
    const found = await store.findByKorean(["물!", "불"]);
    expect([...found.keys()]).toEqual(["물!"]);
    expect(found.get("물!")?.id).toBe(water!.id);
  });

  it("finds by text in any field and by tag, newest first", async () => {
    const store = new SqliteCardStore(openDb(":memory:"));
    await store.insert([{ ...card("사과", "Яблоко"), romanization: "sagwa", tags: ["еда"] }, card("책", "книга")], "claude");
    expect((await store.find({ text: "SAGWA", limit: 10 })).map((c) => c.korean)).toEqual(["사과"]);
    expect((await store.find({ text: "яблоко", limit: 10 })).map((c) => c.korean)).toEqual(["사과"]);
    expect((await store.find({ tag: "еда", limit: 10 })).map((c) => c.korean)).toEqual(["사과"]);
    expect((await store.find({ limit: 10 })).map((c) => c.korean)).toEqual(["책", "사과"]);
  });

  it("updates a card, returns null for an unknown id and throws on a duplicate", async () => {
    const store = new SqliteCardStore(openDb(":memory:"));
    const [a, b] = await store.insert([card("물", "вода"), card("불", "огонь")], "claude");
    expect((await store.update(a!.id, { meaning: "вода!" }))?.meaning).toBe("вода!");
    expect(await store.update("999", { meaning: "x" })).toBeNull();
    expect(await store.update("abc", { meaning: "x" })).toBeNull();
    await expect(store.update(b!.id, { korean: "물" })).rejects.toThrow();
  });

  it("counts due cards, streak and weak sounds", async () => {
    const db = openDb(":memory:");
    const store = new SqliteCardStore(db);
    const [water] = await store.insert([card("물", "вода"), card("TV", "телевизор")], "claude");
    // Cards get the real clock as their creation time, so "now" must not be a fixed date.
    const now = new Date();
    const day = 86_400_000;
    for (const [i, offset] of [0, 1, 2, 4].entries()) {
      db.insert(reviewLog)
        .values({ id: `r${i}`, cardId: Number(water!.id), mode: "meaning", rating: "good", reviewedAt: new Date(now.getTime() - offset * day) })
        .run();
    }
    db.insert(phoneStats).values([
      { phone: "ʌ", attempts: 10, errors: 6 },
      { phone: "k͈", attempts: 4, errors: 1 },
    ]).run();
    expect(await store.stats(new Date(now.getTime() + 60_000))).toMatchObject({ cards: 2, dueSpeech: 1, streakDays: 3 });
    expect(streakDays(db, new Date(now.getTime() + day))).toBe(3);
    expect(streakDays(db, new Date(now.getTime() + 2 * day))).toBe(0);
    expect(await store.weakSounds(1)).toEqual([{ phone: "ʌ", attempts: 10, errors: 6, errorRate: 0.6 }]);
  });
});

describe("SqliteOAuthStore", () => {
  it("stores clients, codes and grants", async () => {
    const store = new SqliteOAuthStore(openDb(":memory:"));
    await store.saveClient({ clientId: "c1", name: "Claude", redirectUris: ["https://claude.ai/cb"], createdAt: 1 });
    await store.saveClient({ clientId: "c2", name: "Claude", redirectUris: ["https://claude.ai/cb"], createdAt: 2 });
    expect(await store.getClient("c1")).toEqual({ clientId: "c1", name: "Claude", redirectUris: ["https://claude.ai/cb"], createdAt: 1 });
    await store.markClientApproved("c1", 5);
    await store.markClientApproved("c1", 9);
    expect((await store.getClient("c1"))?.approvedAt).toBe(5);
    expect(await store.evictOldestUnapprovedClient()).toBe(true);
    expect(await store.getClient("c2")).toBeNull();
    expect(await store.evictOldestUnapprovedClient()).toBe(false);
    expect(await store.countClients()).toBe(1);

    const code = { codeHash: "h", clientId: "c1", redirectUri: "https://claude.ai/cb", codeChallenge: "x", scope: "cards", expiresAt: Date.now() + 60_000 };
    await store.saveCode(code);
    expect(await store.takeCode("h")).toEqual(code);
    expect(await store.takeCode("h")).toBeNull();

    const grant = {
      id: "g1", clientId: "c1", scope: "cards", createdAt: 1, lastUsedAt: 1,
      accessHash: "a1", accessExpiresAt: 2, refreshHash: "r1", refreshExpiresAt: 3, usedRefreshHashes: [] as string[],
    };
    await store.saveGrant(grant);
    await store.saveGrant({ ...grant, accessHash: "a2", refreshHash: "r2", usedRefreshHashes: ["r1"] });
    expect((await store.findGrantByAccess("a2"))?.id).toBe("g1");
    expect(await store.findGrantByAccess("a1")).toBeNull();
    expect((await store.findGrantByRefresh("r1"))?.refreshHash).toBe("r2");
    await store.touchGrant("g1", 7);
    expect((await store.listGrants())[0]?.lastUsedAt).toBe(7);
    await store.deleteGrant("g1");
    expect(await store.listGrants()).toEqual([]);
  });
});
