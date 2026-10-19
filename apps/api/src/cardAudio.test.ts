import { describe, expect, it, vi } from "vitest";
import { audioWorker, BadTextError, httpSpeaker, type Speaker } from "./cardAudio.js";
import { testApp } from "./testing.js";

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
    const worker = audioWorker(t.db, speaker, () => t.clock.now);
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

  it("is made again when the Korean changes and goes with the card", async () => {
    const t = await withCards("물");
    const { speaker, calls } = fakeSpeaker();
    const worker = audioWorker(t.db, speaker, () => t.clock.now);
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
    const worker = audioWorker(t.db, speaker, () => t.clock.now);
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
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("%EB%AC%BC") ? new Response(mp3("물")) : new Response("bad", { status: 422 }),
    );
    const speaker = httpSpeaker("http://scorer", fetchImpl as typeof fetch);
    expect(new TextDecoder().decode(await speaker.speak("물"))).toBe("mp3:물");
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://scorer/tts?text=%EB%AC%BC");
    await expect(speaker.speak("x")).rejects.toBeInstanceOf(BadTextError);

    const down = httpSpeaker("http://scorer", (async () => new Response("", { status: 503 })) as typeof fetch);
    await expect(down.speak("물")).rejects.not.toBeInstanceOf(BadTextError);
  });
});
