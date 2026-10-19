import { describe, expect, it } from "vitest";
import { audioWorker, type Speaker } from "./cardAudio.js";
import { addDrills } from "./practice.js";
import { testApp } from "./testing.js";

const mp3 = (text: string) => new TextEncoder().encode(`mp3:${text}`);

function fakeSpeaker() {
  const calls: string[] = [];
  const speaker: Speaker = {
    async speak(text) {
      calls.push(text);
      return mp3(text);
    },
  };
  return { speaker, calls };
}

const examples = [
  { ko: "물을 마셔요.", ru: "Пью воду." },
  { ko: "물이 차가워요.", ru: "Вода холодная." },
  { ko: "물 주세요.", ru: "Воды, пожалуйста." },
];

async function setup() {
  const t = testApp();
  await t.signIn();
  const id = (await t.request("/cards", { body: { korean: "물", meaning: "вода", examples } })).json.card.id as number;
  await t.request("/cards", { body: { korean: "밥", meaning: "рис" } });
  addDrills(t.db, [{ contrast: "ㅂ/ㅍ/ㅃ", words: [{ korean: "불", meaning: "огонь" }, { korean: "풀" }] }], "claude");
  return { ...t, id };
}

describe("practice audio", () => {
  it("is made after the cards' own audio: drill words, then examples", async () => {
    const t = await setup();
    const { speaker, calls } = fakeSpeaker();
    const worker = audioWorker(t.db, speaker, () => t.clock.now);
    expect(await worker.runOnce()).toBe(7);
    expect(calls).toEqual(["물", "밥", "불", "풀", ...examples.map((e) => e.ko)]);
    expect(await worker.runOnce()).toBe(0);

    const res = await t.request(`/practice/audio?text=${encodeURIComponent("물이 차가워요.")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.text).toBe("mp3:물이 차가워요.");
    expect((await t.request(`/practice/audio?text=${encodeURIComponent("없는 문장")}`)).status).toBe(404);

    t.jar.clear();
    expect((await t.request(`/practice/audio?text=${encodeURIComponent("물 주세요.")}`)).status).toBe(401);
  });

  it("is dropped when the example changes", async () => {
    const t = await setup();
    const { speaker, calls } = fakeSpeaker();
    const worker = audioWorker(t.db, speaker, () => t.clock.now);
    await worker.runOnce();
    const changed = [{ ko: "물을 많이 마셔요.", ru: "Пью много воды." }, ...examples.slice(1)];
    await t.request(`/cards/${t.id}`, { method: "PATCH", body: { examples: changed } });
    expect(await worker.runOnce()).toBe(1);
    expect(calls.at(-1)).toBe("물을 많이 마셔요.");
    expect((await t.request(`/practice/audio?text=${encodeURIComponent("물을 마셔요.")}`)).status).toBe(404);
  });
});

describe("shadowing", () => {
  it("offers only examples that have audio, one per card", async () => {
    const t = await setup();
    expect((await t.request("/practice/shadowing")).json.items).toEqual([]);
    await audioWorker(t.db, fakeSpeaker().speaker, () => t.clock.now).runOnce();
    const { items } = (await t.request("/practice/shadowing?limit=5")).json;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ cardId: t.id, word: "물", meaning: "вода" });
    expect(examples.map((e) => e.ko)).toContain(items[0].ko);
  });
});

describe("sound drills", () => {
  it("are listed with readiness, counted and deleted from the app", async () => {
    const t = await setup();
    addDrills(t.db, [{ contrast: "ㄱ/ㅋ/ㄲ", words: [{ korean: "기" }, { korean: "키" }, { korean: "끼" }] }], "claude");
    let { drills } = (await t.request("/practice/drills")).json;
    expect(drills.map((d: { ready: boolean }) => d.ready)).toEqual([false, false]);

    await audioWorker(t.db, fakeSpeaker().speaker, () => t.clock.now).runOnce();
    const [first, second] = (await t.request("/practice/drills")).json.drills;
    expect(first.ready && second.ready).toBe(true);

    // The one answered wrong moves to the front.
    expect((await t.request(`/practice/drills/${second.id}/answers`, { body: { correct: false } })).status).toBe(200);
    await t.request(`/practice/drills/${first.id}/answers`, { body: { correct: true } });
    ({ drills } = (await t.request("/practice/drills")).json);
    expect(drills[0]).toMatchObject({ id: second.id, wrong: 1, correct: 0 });
    expect(drills[1]).toMatchObject({ id: first.id, wrong: 0, correct: 1 });

    expect((await t.request(`/practice/drills/999/answers`, { body: { correct: true } })).status).toBe(404);
    expect((await t.request(`/practice/drills/${first.id}/answers`, { body: {} })).status).toBe(400);
    expect((await t.request(`/practice/drills/${first.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await t.request("/practice/drills")).json.drills).toHaveLength(1);
  });

  it("skips a set of words that is already there", () => {
    const t = testApp();
    const words = [{ korean: "달" }, { korean: "탈" }];
    expect(addDrills(t.db, [{ contrast: "ㄷ/ㅌ", words }], "claude").created).toHaveLength(1);
    expect(addDrills(t.db, [{ contrast: "ㄷ/ㅌ", words: [...words].reverse() }], "app").duplicates).toEqual([
      { contrast: "ㄷ/ㅌ", words: ["탈", "달"], existingId: 1 },
    ]);
  });
});
