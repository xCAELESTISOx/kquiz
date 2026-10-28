import { describe, expect, it, vi } from "vitest";
import { audioWorker, BadTextError, httpSpeaker, type Speaker } from "./cardAudio.js";
import { createCards } from "./cardStore.js";
import { users } from "./db/schema.js";
import { testApp } from "./testing.js";
import { OWNER_ID } from "./users.js";

const mp3 = (text: string) => new TextEncoder().encode(`mp3:${text}`);

function fakeSpeaker(fail: (text: string) => Error | undefined = () => undefined) {
  const calls: string[] = [];
  const speaker: Speaker = {
    async speak(text) {
      calls.push(text);
      const error = fail(text);
      if (error) throw error;
      return mp3(text);
    },
  };
  return { speaker, calls };
}

async function withCards(...korean: string[]) {
  const t = testApp();
  await t.signIn();
  const ids: number[] = [];
  for (const k of korean) ids.push((await t.request("/cards", { body: { korean: k, meaning: "что-то" } })).json.card.id);
  return { ...t, ids };
}

describe("card audio", () => {
  it("is made once per card and served to the signed-in app", async () => {
    const t = await withCards("물", "국물");
    expect((await t.request(`/cards/${t.ids[0]}/audio`)).status).toBe(404);

    const { speaker, calls } = fakeSpeaker();
    const worker = audioWorker(t.db, speaker, () => t.clock.now, []);
    expect(await worker.runOnce()).toBe(2);
    expect(await worker.runOnce()).toBe(0);
    expect(calls).toEqual(["물", "국물"]);

    const res = await t.request(`/cards/${t.ids[1]}/audio`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.text).toBe("mp3:국물");
    const again = await t.request(`/cards/${t.ids[1]}/audio`, { headers: { "if-none-match": res.headers.get("etag")! } });
    expect(again.status).toBe(304);

    t.jar.clear();
    expect((await t.request(`/cards/${t.ids[1]}/audio`)).status).toBe(401);
  });

  it("is made once for a word two people both have, the owner's cards first", async () => {
    const t = testApp();
    const friend = t.db
      .insert(users)
      .values({ name: "Миша", role: "member", webauthnId: "friend", createdAt: t.clock.now })
      .returning()
      .get();
    createCards(t.db, friend.id, [{ korean: "불", meaning: "огонь", tags: [] }, { korean: "물", meaning: "вода", tags: [] }], "app");
    createCards(t.db, OWNER_ID, [{ korean: "물", meaning: "вода", tags: [] }], "app");

    const { speaker, calls } = fakeSpeaker();
    expect(await audioWorker(t.db, speaker, () => t.clock.now, []).runOnce()).toBe(2);
    expect(calls).toEqual(["물", "불"]);
  });

  it("is made again when the Korean changes and goes with the card", async () => {
    const t = await withCards("물");
    const { speaker, calls } = fakeSpeaker();
    const worker = audioWorker(t.db, speaker, () => t.clock.now, []);
    await worker.runOnce();

    await t.request(`/cards/${t.ids[0]}`, { method: "PATCH", body: { korean: "냉수" } });
    expect((await t.request(`/cards/${t.ids[0]}/audio`)).status).toBe(404);
    await t.request(`/cards/${t.ids[0]}`, { method: "PATCH", body: { meaning: "холодная вода" } });
    await worker.runOnce();
    expect(calls).toEqual(["물", "냉수"]);
    expect((await t.request(`/cards/${t.ids[0]}/audio`)).text).toBe("mp3:냉수");

    await t.request(`/cards/${t.ids[0]}`, { method: "DELETE" });
    expect(await worker.runOnce()).toBe(0);
  });

  it("stops a pass while the scorer is down and skips texts it refuses", async () => {
    const t = await withCards("물", "국물", "밥");
    let down = true;
    const { speaker, calls } = fakeSpeaker((text) =>
      text === "물" ? new BadTextError("no") : down && text === "국물" ? new Error("scorer /tts answered 503") : undefined,
    );
    const worker = audioWorker(t.db, speaker, () => t.clock.now, []);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await worker.runOnce()).toBe(0);
    expect(calls).toEqual(["물", "국물"]);
    down = false;
    expect(await worker.runOnce()).toBe(2);
    expect(calls).toEqual(["물", "국물", "국물", "밥"]);

    // The refused card is tried again a day later.
    t.clock.now = new Date(t.clock.now.getTime() + 25 * 60 * 60 * 1000);
    await worker.runOnce();
    expect(calls.at(-1)).toBe("물");
  });
});

describe("httpSpeaker", () => {
  it("posts the text and tells refused text from other failures", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const voice = new URL(String(url)).searchParams.get("voice");
      return String(url).includes("%EB%AC%BC")
        ? new Response(mp3("물"), { headers: voice ? { "x-tts-voice": voice } : {} })
        : new Response("bad", { status: 422 });
    });
    const speaker = httpSpeaker("http://scorer", fetchImpl as typeof fetch);
    expect(new TextDecoder().decode(await speaker.speak("물"))).toBe("mp3:물");
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://scorer/tts?text=%EB%AC%BC");
    await expect(speaker.speak("x")).rejects.toBeInstanceOf(BadTextError);
    await speaker.speak("물", "M3");
    expect(fetchImpl.mock.calls[2]![0]).toBe("http://scorer/tts?text=%EB%AC%BC&voice=M3");
    // An older scorer that answers in its default voice is not taken for another one.
    const old = httpSpeaker("http://scorer", (async () => new Response(mp3("물"))) as typeof fetch);
    await expect(old.speak("물", "M1")).rejects.not.toBeInstanceOf(BadTextError);

    const down = httpSpeaker("http://scorer", (async () => new Response("", { status: 503 })) as typeof fetch);
    await expect(down.speak("물")).rejects.not.toBeInstanceOf(BadTextError);
  });
});
