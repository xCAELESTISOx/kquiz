import { describe, expect, it } from "vitest";
import { audioWorker, type Speaker } from "./cardAudio.js";
import { createCards } from "./cardStore.js";
import { users } from "./db/schema.js";
import { addDrills } from "./practice.js";
import { testApp } from "./testing.js";
import { OWNER_ID } from "./users.js";
import { EXTRA_VOICES } from "./voices.js";

function fakeSpeaker() {
  const calls: string[] = [];
  const speaker: Speaker = {
    async speak(text, voice) {
      const said = voice ? `${voice}:${text}` : text;
      calls.push(said);
      return new TextEncoder().encode(`mp3:${said}`);
    },
  };
  return { speaker, calls };
}

async function setup() {
  const t = testApp();
  await t.signIn();
  const id = (await t.request("/cards", { body: { korean: "물", meaning: "вода" } })).json.card.id as number;
  addDrills(t.db, OWNER_ID, [{ contrast: "ㅂ/ㅍ", words: [{ korean: "불" }, { korean: "풀" }] }], "claude");
  return { ...t, id };
}

describe("other voices", () => {
  it("are made last, one per pass, card words before drill words", async () => {
    const t = await setup();
    const { speaker, calls } = fakeSpeaker();
    const worker = audioWorker(t.db, speaker, () => t.clock.now);
    while ((await worker.runOnce()) > 0);
    expect(calls).toEqual([
      "물",
      "불",
      "풀",
      ...["물", "불", "풀"].flatMap((word) => EXTRA_VOICES.map((voice) => `${voice}:${word}`)),
    ]);
    expect(await worker.runOnce()).toBe(0);
  });

  it("are served for the owner's card and drill words only", async () => {
    const t = await setup();
    const url = `/cards/${t.id}/audio?voice=M1`;
    expect((await t.request(url)).status).toBe(404);
    const worker = audioWorker(t.db, fakeSpeaker().speaker, () => t.clock.now);
    while ((await worker.runOnce()) > 0);

    const res = await t.request(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.text).toBe("mp3:M1:물");
    expect((await t.request(url, { headers: { "if-none-match": res.headers.get("etag")! } })).status).toBe(304);
    expect((await t.request(`/cards/${t.id}/audio`)).text).toBe("mp3:물");
    expect((await t.request(`/cards/${t.id}/audio?voice=F1`)).status).toBe(404);
    expect((await t.request(`/practice/audio?text=${encodeURIComponent("풀")}&voice=F3`)).text).toBe("mp3:F3:풀");

    const friend = t.db.insert(users).values({ name: "Миша", role: "member", webauthnId: "friend", createdAt: t.clock.now }).returning().get();
    const [theirs] = createCards(t.db, friend.id, [{ korean: "물", meaning: "вода", tags: [] }], "app").created;
    expect((await t.request(`/cards/${theirs!.id}/audio?voice=M1`)).status).toBe(404);
  });

  it("come with listening items and drills, and stay after the word changes", async () => {
    const t = await setup();
    const worker = audioWorker(t.db, fakeSpeaker().speaker, () => t.clock.now, ["M1"]);
    // Only the default voice so far.
    for (let i = 0; i < 2; i++) await worker.runOnce();
    const listening = async () => (await t.request("/reviews/queue?mode=listening")).json.items;
    expect((await listening())[0].voices).toEqual([]);
    expect((await t.request("/practice/drills")).json.drills[0].voices).toEqual([]);

    while ((await worker.runOnce()) > 0);
    expect((await listening())[0].voices).toEqual(["M1"]);
    expect((await t.request("/reviews/queue?mode=meaning")).json.items[0].voices).toBeUndefined();
    expect((await t.request("/practice/drills")).json.drills[0].voices).toEqual(["M1"]);

    await t.request(`/cards/${t.id}`, { method: "PATCH", body: { korean: "냉수" } });
    expect((await t.request(`/cards/${t.id}/audio?voice=M1`)).status).toBe(404);
    while ((await worker.runOnce()) > 0);
    expect((await t.request(`/cards/${t.id}/audio?voice=M1`)).text).toBe("mp3:M1:냉수");
    expect((await t.request(`/practice/audio?text=${encodeURIComponent("물")}&voice=M1`)).status).toBe(200);
  });
});
