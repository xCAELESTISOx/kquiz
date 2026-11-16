import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createCards, getCard, updateCard } from "./cardStore.js";
import { openDb } from "./db/client.js";
import { pictures } from "./db/schema.js";
import { fetchPicture, importLibrary, isPrivateAddress, libraryKeys, MAX_SIDE, processPicture, setCardPicture } from "./pictures.js";
import { SqlitePictureStore } from "./storage/mcp.js";
import { testApp } from "./testing.js";
import { OWNER_ID } from "./users.js";

const now = new Date("2026-11-16T09:00:00Z");

/** A plain PNG of the given size and colour. */
function png(width: number, height: number, color = "#3366cc") {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

const b64 = async (width: number, height: number, color?: string) => (await png(width, height, color)).toString("base64");

describe("processing a picture", () => {
  it("re-encodes any shape as a WebP no bigger than the frame needs", async () => {
    const wide = await processPicture(await png(2400, 400));
    expect(wide.mime).toBe("image/webp");
    expect([wide.width, wide.height]).toEqual([MAX_SIDE, 120]);
    expect((await sharp(wide.data).metadata()).format).toBe("webp");
    // Small pictures stay their size: blowing them up would only add bytes.
    const small = await processPicture(await png(150, 140));
    expect([small.width, small.height]).toEqual([150, 140]);
  });

  it("refuses what isn't a picture", async () => {
    await expect(processPicture(Buffer.from("<svg onload=alert(1)>"))).rejects.toThrow(/can read/);
  });
});

describe("the picture library", () => {
  it("finds a pack's word under each of its spellings", () => {
    expect(libraryKeys("아내/와이프")).toEqual(["아내", "와이프"]);
    expect(libraryKeys("사진가 / 사진작가")).toEqual(["사진가", "사진작가"]);
    expect(libraryKeys("cat")).toEqual([]);
  });

  it("gives its pictures to cards already in the deck and to ones added later, and updates them", async () => {
    const db = openDb(":memory:");
    const [subway] = createCards(db, OWNER_ID, [{ korean: "지하철", meaning: "метро" }, { korean: "물", meaning: "вода" }], "app", now).created;
    const first = await importLibrary(db, [{ korean: "지하철", meaning: "метро", data: await b64(237, 123) }, { korean: "아내/와이프", data: await b64(130, 101, "#aa3344") }], now);
    expect(first).toMatchObject({ added: 3, cardsUpdated: 1, total: 3, rejected: [] });
    const picture = getCard(db, OWNER_ID, subway!.id)!.picture!;
    expect(picture).toMatchObject({ from: "library", width: 237, height: 123, hasText: false });
    expect(picture.url).toMatch(/^\/api\/pictures\/[0-9a-f]{32}$/);
    // A word added after the import starts with its picture.
    const [wife] = createCards(db, OWNER_ID, [{ korean: "와이프", meaning: "жена" }], "app", now).created;
    expect(wife!.picture?.from).toBe("library");
    // A new picture for the word reaches the card under a new address, and the old one is gone.
    const second = await importLibrary(db, [{ korean: "지하철", data: await b64(200, 200, "#22aa66"), hasText: true }], now);
    expect(second).toMatchObject({ updated: 1, cardsUpdated: 1 });
    const updated = getCard(db, OWNER_ID, subway!.id)!.picture!;
    expect(updated.url).not.toBe(picture.url);
    expect(updated.hasText).toBe(true);
    expect(db.select().from(pictures).all()).toHaveLength(2);
    // The same picture again changes nothing.
    expect(await importLibrary(db, [{ korean: "지하철", data: await b64(200, 200, "#22aa66"), hasText: true }], now)).toMatchObject({ unchanged: 1, cardsUpdated: 0 });
  });

  it("leaves a card's own picture, or none, alone; a renamed word takes the library's", async () => {
    const db = openDb(":memory:");
    await importLibrary(db, [{ korean: "학교", data: await b64(188, 115) }, { korean: "학생", data: await b64(94, 172) }, { korean: "사과", data: await b64(140, 140, "#cc2222") }], now);
    const [school, student, water] = createCards(db, OWNER_ID, [{ korean: "학교", meaning: "школа" }, { korean: "학생", meaning: "ученик" }, { korean: "물", meaning: "вода" }], "app", now).created;
    setCardPicture(db, OWNER_ID, school!.id, { own: await processPicture(await png(300, 300, "#ff0000")), hasText: false }, now);
    setCardPicture(db, OWNER_ID, student!.id, "none", now);
    await importLibrary(db, [{ korean: "학교", data: await b64(120, 120, "#000000") }, { korean: "학생", data: await b64(80, 160, "#111111") }], now);
    expect(getCard(db, OWNER_ID, school!.id)!.picture).toMatchObject({ from: "own", width: 300 });
    expect(getCard(db, OWNER_ID, student!.id)!.picture).toBeNull();
    // Back to the library's picture on request.
    setCardPicture(db, OWNER_ID, student!.id, "library", now);
    expect(getCard(db, OWNER_ID, student!.id)!.picture).toMatchObject({ from: "library", width: 80 });
    // A word with no picture gets one when it is renamed to a word the library has.
    expect(water!.picture).toBeNull();
    updateCard(db, OWNER_ID, water!.id, { korean: "사과" }, now);
    expect(getCard(db, OWNER_ID, water!.id)!.picture).toMatchObject({ from: "library", width: 140 });
  });
});

describe("pictures from the web", () => {
  it("knows which addresses are not public", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(a)).toBe(true);
    for (const a of ["8.8.8.8", "179.236.41.211", "2606:4700::1111"]) expect(isPrivateAddress(a)).toBe(false);
  });

  it("downloads only from public https hosts, also after a redirect", async () => {
    const image = await png(64, 64);
    const resolve = async (host: string) => (host === "inside.example" ? ["10.0.0.5"] : ["93.184.216.34"]);
    const fetchImpl = (async (url: URL) =>
      url.pathname === "/moved" ? new Response(null, { status: 302, headers: { location: "https://inside.example/secret" } }) : new Response(image)) as unknown as typeof fetch;
    expect((await fetchPicture("https://pics.example/a.png", { resolve, fetchImpl })).equals(image)).toBe(true);
    await expect(fetchPicture("http://pics.example/a.png", { resolve, fetchImpl })).rejects.toThrow(/https/);
    await expect(fetchPicture("https://inside.example/a.png", { resolve, fetchImpl })).rejects.toThrow(/not public/);
    await expect(fetchPicture("https://pics.example/moved", { resolve, fetchImpl })).rejects.toThrow(/not public/);
    await expect(fetchPicture("https://127.0.0.1/a.png", { resolve, fetchImpl })).rejects.toThrow(/not public/);
  });

  it("set_picture puts a downloaded picture on a card, and takes it off", async () => {
    const db = openDb(":memory:");
    const [card] = createCards(db, OWNER_ID, [{ korean: "염소", meaning: "коза" }], "app", now).created;
    const image = await png(164, 149);
    const store = new SqlitePictureStore(db, OWNER_ID, () => now, async () => image);
    expect(await store.set(String(card!.id), { url: "https://pics.example/goat.png", hasText: false })).toEqual({ ok: true, picture: { from: "own", hasText: false } });
    expect(await store.set(String(card!.id), { hasText: true })).toEqual({ ok: true, picture: { from: "own", hasText: true } });
    expect(await store.set(String(card!.id), { remove: true })).toEqual({ ok: true, picture: null });
    expect(await store.set("999", { remove: true })).toMatchObject({ ok: false });
    const broken = new SqlitePictureStore(db, OWNER_ID, () => now, async () => Buffer.from("not an image"));
    expect(await broken.set(String(card!.id), { url: "https://pics.example/x" })).toMatchObject({ ok: false, error: expect.stringMatching(/Picture not set/) });
  });
});

describe("picture routes", () => {
  it("serves pictures to people signed in, forever cacheable, and only the owner imports", async () => {
    const t = testApp();
    expect((await t.request("/pictures/library")).status).toBe(401);
    await t.signIn();
    const imported = await t.request("/pictures/library", { body: { entries: [{ korean: "지하철", meaning: "метро", data: await b64(237, 123) }] } });
    expect(imported.json).toMatchObject({ added: 1, total: 1 });
    const added = await t.request("/cards", { body: { korean: "지하철", meaning: "метро" } });
    const url: string = added.json.card.picture.url;
    const res = await t.request(url.replace(/^\/api/, ""));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect((await t.request("/pictures/0123456789abcdef0123456789abcdef")).status).toBe(404);
    expect((await t.request("/pictures/library", { body: { entries: [] } })).status).toBe(400);
  });
});
