import { describe, expect, it } from "vitest";
import { openDb } from "../db/client.js";
import { reviewLog, reviewStates, users } from "../db/schema.js";
import { phoneStats } from "../db/schema.js";
import { SqliteCardStore, SqliteOAuthStore, sqliteStores, streakDays } from "./mcp.js";
import { introduceEarly } from "../newCards.js";
import { eq } from "drizzle-orm";
import { OWNER_ID } from "../users.js";

const card = (korean: string, meaning: string) => ({ korean, meaning, tags: [] as string[] });

describe("SqliteCardStore", () => {
  it("finds existing cards by normalized Korean, ignoring punctuation", async () => {
    const store = new SqliteCardStore(openDb(":memory:"), OWNER_ID);
    const [water] = await store.insert([card("물", "вода")], "claude");
    expect(water).toMatchObject({ id: expect.any(String), korean: "물", source: "claude", speakable: true });
    const found = await store.findByKorean(["물!", "불"]);
    expect([...found.keys()]).toEqual(["물!"]);
    expect(found.get("물!")?.id).toBe(water!.id);
  });

  it("finds by text in any field and by tag, newest first", async () => {
    const store = new SqliteCardStore(openDb(":memory:"), OWNER_ID);
    await store.insert([{ ...card("사과", "Яблоко"), romanization: "sagwa", tags: ["еда"] }, card("책", "книга")], "claude");
    expect((await store.find({ text: "SAGWA", limit: 10 })).map((c) => c.korean)).toEqual(["사과"]);
    expect((await store.find({ text: "яблоко", limit: 10 })).map((c) => c.korean)).toEqual(["사과"]);
    expect((await store.find({ tag: "еда", limit: 10 })).map((c) => c.korean)).toEqual(["사과"]);
    expect((await store.find({ limit: 10 })).map((c) => c.korean)).toEqual(["책", "사과"]);
  });

  it("updates a card, returns null for an unknown id and throws on a duplicate", async () => {
    const store = new SqliteCardStore(openDb(":memory:"), OWNER_ID);
    const [a, b] = await store.insert([card("물", "вода"), card("불", "огонь")], "claude");
    expect((await store.update(a!.id, { meaning: "вода!" }))?.meaning).toBe("вода!");
    expect(await store.update("999", { meaning: "x" })).toBeNull();
    expect(await store.update("abc", { meaning: "x" })).toBeNull();
    await expect(store.update(b!.id, { korean: "물" })).rejects.toThrow();
  });

  it("sets roots without counting it as an edit, and finds cards that still have none", async () => {
    const store = new SqliteCardStore(openDb(":memory:"), OWNER_ID);
    const [school, love] = await store.insert([card("학교", "школа"), card("사랑", "любовь"), card("책", "книга")], "claude");
    const 學 = { ko: "학", hanja: "學", meaning: "учёба" };
    expect(await store.setRoots([{ id: school!.id, roots: [學] }, { id: love!.id, roots: [] }, { id: "999", roots: [] }])).toEqual({
      saved: [school!.id, love!.id],
      notFound: ["999"],
    });
    const [found] = await store.find({ root: "學", limit: 10 });
    expect(found).toMatchObject({ korean: "학교", roots: [學], updatedAt: school!.updatedAt });
    expect((await store.find({ withoutRoots: true, limit: 10 })).map((c) => c.korean)).toEqual(["책"]);
  });

  it("counts due cards, streak and weak sounds", async () => {
    const db = openDb(":memory:");
    const store = new SqliteCardStore(db, OWNER_ID);
    const [water, tv] = await store.insert([card("물", "вода"), card("TV", "телевизор")], "claude");
    for (const c of [water!, tv!]) introduceEarly(db, OWNER_ID, Number(c.id), new Date());
    // Cards get the real clock as their creation time, so "now" must not be a fixed date.
    const now = new Date();
    const day = 86_400_000;
    for (const [i, offset] of [0, 1, 2, 4].entries()) {
      db.insert(reviewLog)
        .values({ id: `r${i}`, cardId: Number(water!.id), mode: "meaning", rating: "good", reviewedAt: new Date(now.getTime() - offset * day) })
        .run();
    }
    db.insert(phoneStats).values([
      { userId: OWNER_ID, phone: "ʌ", attempts: 10, errors: 6 },
      { userId: OWNER_ID, phone: "k͈", attempts: 4, errors: 1 },
    ]).run();
    expect(await store.stats(new Date(now.getTime() + 60_000))).toMatchObject({ cards: 2, dueSpeech: 1, streakDays: 3 });
    expect(streakDays(db, OWNER_ID, new Date(now.getTime() + day))).toBe(3);
    expect(streakDays(db, OWNER_ID, new Date(now.getTime() + 2 * day))).toBe(0);
    expect(await store.weakSounds(1)).toEqual([{ phone: "ʌ", attempts: 10, errors: 6, errorRate: 0.6 }]);
  });
});

describe("SqliteSharingStore", () => {
  it("copies the owner's cards to a member as new words, with links between them", async () => {
    const db = openDb(":memory:");
    const friend = db.insert(users).values({ name: "Миша", role: "member", webauthnId: "friend", createdAt: new Date() }).returning().get();
    const mine = new SqliteCardStore(db, OWNER_ID);
    const examples = [1, 2, 3].map((i) => ({ ko: `물 ${i}`, ru: `вода ${i}` }));
    const [water, fire, book] = await mine.insert(
      [{ ...card("물", "вода"), examples, notes: "+ 물병 — бутылка", roots: [] }, card("불", "огонь"), card("책", "книга")],
      "app",
    );
    await mine.linkSimilar([{ korean: "물", other: "불", note: "вода / огонь" }]);
    introduceEarly(db, OWNER_ID, Number(water!.id), new Date());
    const theirs = new SqliteCardStore(db, friend.id);
    await theirs.insert([card("책", "книжка")], "app");

    expect(sqliteStores(db, "UTC")(friend.id)?.sharing).toBeUndefined();
    const sharing = sqliteStores(db, "UTC")(OWNER_ID)!.sharing!;
    expect(await sharing.members()).toEqual([{ id: String(friend.id), name: "Миша", cards: 1 }]);
    expect(await sharing.share(String(OWNER_ID), [water!.id])).toBeNull();

    const result = await sharing.share(String(friend.id), [fire!.id, water!.id, book!.id, "999"]);
    expect(result).toMatchObject({
      member: "Миша",
      created: [{ korean: "불" }, { korean: "물" }],
      duplicates: ["책"],
      notFound: ["999"],
      similar: { linked: [{ korean: "물", other: "불" }] },
    });
    const [copy] = await theirs.find({ text: "물", limit: 5 });
    expect(copy).toMatchObject({ meaning: "вода", examples, notes: "+ 물병 — бутылка", roots: [], queued: true, similar: [{ korean: "불", note: "вода / огонь" }] });
    expect(db.select().from(reviewStates).where(eq(reviewStates.cardId, Number(copy!.id))).all()).toEqual([]);
    expect((await theirs.find({ text: "책", limit: 5 }))[0]?.meaning).toBe("книжка");
    expect((await mine.get(water!.id))?.queued).toBe(false);
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

    const code = { codeHash: "h", userId: OWNER_ID, clientId: "c1", redirectUri: "https://claude.ai/cb", codeChallenge: "x", scope: "cards", expiresAt: Date.now() + 60_000 };
    await store.saveCode(code);
    expect(await store.takeCode("h")).toEqual(code);
    expect(await store.takeCode("h")).toBeNull();

    const grant = {
      id: "g1", userId: OWNER_ID, clientId: "c1", scope: "cards", createdAt: 1, lastUsedAt: 1,
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
