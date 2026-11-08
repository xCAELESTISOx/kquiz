import { describe, expect, it } from "vitest";
import { signed, testApp } from "./testing.js";
import { MAX_USERS, MEMBER_LIMITS } from "./users.js";

/** The owner signed in, a friend invited and signed in from a second browser. */
async function withFriend() {
  const t = testApp();
  await t.signIn();
  const friend = t.browser();
  const invite = await t.request("/users/invites", { body: {} });
  expect(invite.status).toBe(201);
  const code = new URL(invite.json.url).hash.replace("#/invite/", "");
  await join(t, friend, code, "Миша", "cred-friend");
  return { ...t, friend, code };
}

type App = ReturnType<typeof testApp>;

/** Passkey requests are limited to a few a minute per address, and every test browser shares one. */
const nextMinute = (t: App) => (t.clock.now = new Date(t.clock.now.getTime() + 61_000));

async function join(t: App, b: Pick<App, "request">, invite: string, userName: string, credential: string) {
  nextMinute(t);
  const options = await b.request("/auth/register/options", { body: { invite, userName } });
  expect(options.status).toBe(200);
  return b.request("/auth/register/verify", { body: { invite, userName, response: signed(options.json.challenge, credential) } });
}

describe("invites", () => {
  it("lets a friend in once, with their own account", async () => {
    const t = await withFriend();
    const status = await t.friend.request("/auth/status");
    expect(status.json).toMatchObject({ authenticated: true, user: { name: "Миша", role: "member" } });
    expect((await t.request("/auth/status")).json.user).toMatchObject({ id: 1, role: "owner" });

    const stranger = t.browser();
    nextMinute(t);
    expect((await stranger.request(`/auth/invite?code=${t.code}`)).json.status).toBe("invalid");
    expect((await stranger.request("/auth/register/options", { body: { invite: t.code, userName: "Чужой" } })).status).toBe(403);
    expect((await stranger.request("/auth/register/options", { body: { invite: "made-up", userName: "Чужой" } })).status).toBe(403);
  });

  it("needs a name, a fresh link and room for one more", async () => {
    const t = testApp();
    await t.signIn();
    const friend = t.browser();
    const code = new URL((await t.request("/users/invites", { body: {} })).json.url).hash.replace("#/invite/", "");
    expect((await friend.request(`/auth/invite?code=${code}`)).json.status).toBe("ok");
    expect((await friend.request("/auth/register/options", { body: { invite: code } })).status).toBe(403);
    t.clock.now = new Date(t.clock.now.getTime() + 25 * 3_600_000);
    expect((await friend.request(`/auth/invite?code=${code}`)).json.status).toBe("invalid");

    for (let i = 2; i <= MAX_USERS; i++) {
      const link = await t.request("/users/invites", { body: {} });
      expect((await join(t, t.browser(), new URL(link.json.url).hash.slice(9), `друг ${i}`, `cred-${i}`)).status).toBe(200);
    }
    expect((await t.request("/users/invites", { body: {} })).json.error).toBe("too_many_users");
  });

  it("keeps the access screen to the owner", async () => {
    const t = await withFriend();
    expect((await t.friend.request("/users")).status).toBe(403);
    expect((await t.friend.request("/users/invites", { body: {} })).status).toBe(403);
    const list = await t.request("/users");
    expect(list.json.users.map((u: { name: string; role: string }) => [u.name, u.role])).toEqual([
      ["Owner", "owner"],
      ["Миша", "member"],
    ]);
  });

  it("signs the friend in with their passkey, without listing anyone's credentials", async () => {
    const t = await withFriend();
    t.friend.jar.clear();
    nextMinute(t);
    const options = await t.friend.request("/auth/login/options", { body: {} });
    expect(options.json.allowCredentials).toBeUndefined();
    await t.friend.request("/auth/login/verify", { body: { response: signed(options.json.challenge, "cred-friend") } });
    expect((await t.friend.request("/auth/status")).json.user.name).toBe("Миша");
    expect((await t.friend.request("/auth/passkeys")).json.passkeys.map((p: { id: string }) => p.id)).toEqual(["cred-friend"]);
  });
});

describe("separate data", () => {
  it("shows each person only their own cards, reviews, drills, settings and export", async () => {
    const t = await withFriend();
    const mine = (await t.request("/cards", { body: { korean: "물", meaning: "вода" } })).json.card;
    expect((await t.friend.request("/cards")).json.cards).toEqual([]);
    expect((await t.friend.request(`/cards/${mine.id}`)).status).toBe(404);
    expect((await t.friend.request(`/cards/${mine.id}`, { method: "PATCH", body: { meaning: "x" } })).status).toBe(404);
    expect((await t.friend.request(`/cards/${mine.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await t.friend.request(`/cards/${mine.id}/audio`)).status).toBe(404);

    // The same word is fine for both.
    const theirs = await t.friend.request("/cards", { body: { korean: "물", meaning: "вода" } });
    expect(theirs.status).toBe(201);

    const review = (cardId: number) => ({
      reviews: [{ id: crypto.randomUUID(), cardId, mode: "meaning", rating: "good", reviewedAt: t.clock.now.toISOString() }],
    });
    expect((await t.friend.request("/reviews", { body: review(mine.id) })).json.results[0].status).toBe("card_not_found");
    expect((await t.friend.request("/reviews", { body: review(theirs.json.card.id) })).json.results[0].status).toBe("applied");
    expect((await t.request("/reviews/stats")).json).toMatchObject({ cards: 1, reviewedToday: 0 });
    expect((await t.friend.request("/reviews/stats")).json).toMatchObject({ cards: 1, reviewedToday: 1 });
    expect((await t.request("/reviews/queue?mode=meaning")).json.items.map((i: { card: { id: number } }) => i.card.id)).toEqual([mine.id]);

    await t.friend.request("/settings", { method: "PATCH", body: { newPerDay: 3 } });
    expect((await t.request("/settings")).json.newPerDay).toBe(15);
    await t.friend.request("/reviews/fsrs", { method: "PUT", body: { mode: "meaning", desiredRetention: 0.85 } });
    expect((await t.request("/reviews/fsrs")).json.modes[0].desiredRetention).toBe(0.9);

    const exported = (await t.friend.request("/export")).json;
    expect(exported.cards.map((c: { id: number }) => c.id)).toEqual([theirs.json.card.id]);
    expect(exported.reviewLog).toHaveLength(1);
    expect((await t.request("/export")).json.reviewLog).toHaveLength(0);

    const stats = (await t.request("/stats")).json;
    expect(stats.cards.total).toBe(1);
    expect(stats.activity.at(-1).reviews).toBe(0);
  });

  it("caps how many cards a member adds in a day", async () => {
    const t = await withFriend();
    const batch = (from: number, n: number) => ({
      cards: Array.from({ length: n }, (_, i) => ({ korean: `단어${String.fromCharCode(0xac00 + from + i)}`, meaning: "слово" })),
    });
    for (let i = 0; i < MEMBER_LIMITS.cardsPerDay; i += 50) {
      expect((await t.friend.request("/cards/bulk", { body: batch(i, 50) })).json.created).toHaveLength(50);
    }
    const over = await t.friend.request("/cards/bulk", { body: batch(1000, 2) });
    expect(over.status).toBe(429);
    expect(over.json).toMatchObject({ error: "quota_exceeded", left: 0 });
    expect((await t.friend.request("/cards/summary")).json.counts.all).toBe(MEMBER_LIMITS.cardsPerDay);
    // The owner has no limit, and the friend gets room again a day later.
    expect((await t.request("/cards/bulk", { body: batch(1000, 2) })).json.created).toHaveLength(2);
    t.clock.now = new Date(t.clock.now.getTime() + 86_400_000 + 1);
    expect((await t.friend.request("/cards/bulk", { body: batch(1000, 2) })).status).toBe(200);
  });
});

describe("switching someone off", () => {
  it("signs a disabled member out everywhere, keeps their data, and deletes it only when asked", async () => {
    const t = await withFriend();
    await t.friend.request("/cards", { body: { korean: "불", meaning: "огонь" } });
    const friendId = (await t.friend.request("/auth/status")).json.user.id;

    expect((await t.request(`/users/${friendId}`, { method: "DELETE" })).json.error).toBe("disable_first");
    expect((await t.request("/users/1/disable", { body: {} })).status).toBe(409);
    expect((await t.request(`/users/${friendId}/disable`, { body: {} })).status).toBe(200);
    expect((await t.friend.request("/cards")).status).toBe(401);

    const again = t.browser();
    nextMinute(t);
    const options = await again.request("/auth/login/options", { body: {} });
    expect((await again.request("/auth/login/verify", { body: { response: signed(options.json.challenge, "cred-friend") } })).status).toBe(400);

    expect((await t.request("/users")).json.users[1]).toMatchObject({ disabled: true, cards: 1 });
    expect((await t.request(`/users/${friendId}`, { method: "DELETE" })).status).toBe(200);
    expect((await t.request("/users")).json.users).toHaveLength(1);
    expect((await t.request("/cards")).json.cards).toEqual([]);
  });
});
