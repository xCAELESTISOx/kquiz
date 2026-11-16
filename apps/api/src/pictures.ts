import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { koreanKey, normalizeKorean } from "./cards.js";
import type { Db } from "./db/client.js";
import { cards, pictureLibrary, pictures } from "./db/schema.js";

// Pictures of words. Any shape is welcome (the app lays it into a fixed frame); every picture is
// re-encoded here, so what is stored and served is always a small WebP of known size, never the
// bytes someone sent.

/** What a card says about its picture (cards.picture). */
export type CardPictureRef =
  | { from: "own" | "library"; hash: string; width: number; height: number; hasText: boolean }
  /** Switched off for this card: no picture, not even the library's. */
  | { from: "none" };

/** A card's picture as the app gets it. */
export type PictureDto = { url: string; width: number; height: number; hasText: boolean; from: "own" | "library" };

/** Longest side stored: the frame is ~400pt wide, so this is sharp on a 3x screen for most pictures. */
export const MAX_SIDE = 720;
/** Bigger inputs are refused before decoding. */
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
/** A stored picture never takes more than this. */
const MAX_STORED_BYTES = 400 * 1024;
/** Library size: enough for any word list, small enough to never fill the disk. */
export const MAX_LIBRARY = 5000;

export class PictureError extends Error {}

export type Processed = { hash: string; data: Buffer; width: number; height: number; mime: "image/webp" };

/** Decodes any common image, turns it upright, shrinks it to MAX_SIDE and re-encodes as WebP. */
export async function processPicture(input: Buffer): Promise<Processed> {
  if (input.length > MAX_INPUT_BYTES) throw new PictureError("the picture is over 8 MB");
  let out: { data: Buffer; info: sharp.OutputInfo };
  try {
    out = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new PictureError("not a picture this server can read (PNG, JPEG, WebP, GIF, AVIF or TIFF)");
  }
  if (out.data.length > MAX_STORED_BYTES) throw new PictureError("the picture is too detailed to store");
  if (out.info.width < 16 || out.info.height < 16) throw new PictureError("the picture is too small");
  const hash = createHash("sha256").update(out.data).digest("hex").slice(0, 32);
  return { hash, data: out.data, width: out.info.width, height: out.info.height, mime: "image/webp" };
}

/** Stores a processed picture (once per content) and returns the reference a card keeps. */
export function storePicture(db: Db, picture: Processed, hasText: boolean, from: "own" | "library", now = new Date()): CardPictureRef {
  db.insert(pictures)
    .values({ hash: picture.hash, mime: picture.mime, width: picture.width, height: picture.height, hasText, data: picture.data, createdAt: now })
    .onConflictDoUpdate({ target: pictures.hash, set: { hasText } })
    .run();
  if (hasText !== undefined) refreshHasText(db, picture.hash, hasText);
  return { from, hash: picture.hash, width: picture.width, height: picture.height, hasText };
}

/** Cards keep a copy of the picture's facts; a changed text mark goes to all of them. */
function refreshHasText(db: Db, hash: string, hasText: boolean) {
  db.update(cards)
    .set({ picture: sql`json_set(${cards.picture}, '$.hasText', json(${hasText ? "true" : "false"}))` })
    .where(sql`json_extract(${cards.picture}, '$.hash') = ${hash}`)
    .run();
}

export function pictureDto(ref: CardPictureRef | null): PictureDto | null {
  if (!ref || ref.from === "none") return null;
  return { url: `/api/pictures/${ref.hash}`, width: ref.width, height: ref.height, hasText: ref.hasText, from: ref.from };
}

export function getPicture(db: Db, hash: string) {
  return db.select({ mime: pictures.mime, data: pictures.data }).from(pictures).where(eq(pictures.hash, hash)).get();
}

/** The library's picture for each of these Korean keys. */
function libraryRefs(db: Db, keys: string[]): Map<string, CardPictureRef> {
  if (!keys.length) return new Map();
  const rows = db
    .select({ key: pictureLibrary.koreanKey, hash: pictures.hash, width: pictures.width, height: pictures.height, hasText: pictures.hasText })
    .from(pictureLibrary)
    .innerJoin(pictures, eq(pictures.hash, pictureLibrary.pictureHash))
    .where(inArray(pictureLibrary.koreanKey, keys))
    .all();
  return new Map(rows.map((r) => [r.key, { from: "library", hash: r.hash, width: r.width, height: r.height, hasText: r.hasText }]));
}

/** The picture a new card starts with: the library's for its word, if any. */
export function libraryPictureFor(db: Db, key: string): CardPictureRef | null {
  return libraryRefs(db, [key]).get(key) ?? null;
}

/**
 * Gives cards without a picture of their own the library's current one for their word (or none),
 * for the given words or all. Run after the library changes; cards with their own picture or with
 * pictures switched off are left alone.
 */
export function applyLibrary(db: Db, keys?: string[]): number {
  const takesLibrary = or(isNull(cards.picture), sql`json_extract(${cards.picture}, '$.from') = 'library'`);
  const rows = db
    .select({ id: cards.id, key: cards.koreanKey, picture: cards.picture })
    .from(cards)
    .where(keys ? and(takesLibrary, inArray(cards.koreanKey, keys)) : takesLibrary)
    .all();
  const refs = libraryRefs(db, [...new Set(rows.map((r) => r.key))]);
  let changed = 0;
  for (const row of rows) {
    const next = refs.get(row.key) ?? null;
    if (JSON.stringify(next) === JSON.stringify(row.picture)) continue;
    db.update(cards).set({ picture: next }).where(eq(cards.id, row.id)).run();
    changed++;
  }
  return changed;
}

/** Drops pictures no card and no library entry points at any more. */
export function prunePictures(db: Db): number {
  return db.run(sql`
    DELETE FROM pictures WHERE hash NOT IN (SELECT picture_hash FROM picture_library)
      AND hash NOT IN (SELECT json_extract(picture, '$.hash') FROM cards WHERE picture IS NOT NULL AND json_extract(picture, '$.hash') IS NOT NULL)
  `).changes;
}

// ---------- Library ----------

/** The keys a pack's word is found under: "아내/와이프" is both 아내 and 와이프, "(사진)작가" loses the brackets. */
export function libraryKeys(korean: string): string[] {
  const parts = korean
    .split(/[/,;]/)
    .map((p) => normalizeKorean(p.replace(/[()[\]]/g, "")))
    .filter((p) => /\p{Script=Hangul}/u.test(p));
  return [...new Set(parts.map(koreanKey).filter(Boolean))];
}

export const libraryEntrySchema = z.object({
  korean: z.string().trim().min(1).max(100),
  meaning: z.string().trim().max(200).optional(),
  topic: z.string().trim().max(100).optional(),
  hasText: z.boolean().optional(),
  /** The picture, base64. */
  data: z.string().min(1).max(1_100_000),
});
export type LibraryEntry = z.infer<typeof libraryEntrySchema>;

export type ImportResult = { added: number; updated: number; unchanged: number; rejected: { korean: string; reason: string }[]; cardsUpdated: number; total: number };

/**
 * Puts pictures into the library under each of their words, replacing older ones, then hands them
 * to every card that takes the library's picture. The first entry for a word in a batch wins.
 */
export async function importLibrary(db: Db, entries: LibraryEntry[], now = new Date()): Promise<ImportResult> {
  const result: ImportResult = { added: 0, updated: 0, unchanged: 0, rejected: [], cardsUpdated: 0, total: 0 };
  const touched = new Set<string>();
  for (const entry of entries) {
    const keys = libraryKeys(entry.korean).filter((k) => !touched.has(k));
    if (!keys.length) {
      if (!libraryKeys(entry.korean).length) result.rejected.push({ korean: entry.korean, reason: "no Korean word" });
      continue;
    }
    let processed: Processed;
    try {
      processed = await processPicture(Buffer.from(entry.data, "base64"));
    } catch (e) {
      result.rejected.push({ korean: entry.korean, reason: e instanceof PictureError ? e.message : "unreadable picture" });
      continue;
    }
    db.transaction((tx) => {
      const size = tx.select({ n: sql<number>`count(*)` }).from(pictureLibrary).get()!.n;
      storePicture(tx as unknown as Db, processed, entry.hasText ?? false, "library", now);
      for (const key of keys) {
        touched.add(key);
        const old = tx.select({ hash: pictureLibrary.pictureHash }).from(pictureLibrary).where(eq(pictureLibrary.koreanKey, key)).get();
        if (old?.hash === processed.hash) {
          result.unchanged++;
          continue;
        }
        if (!old && size + result.added >= MAX_LIBRARY) {
          result.rejected.push({ korean: entry.korean, reason: `the library is full (${MAX_LIBRARY})` });
          continue;
        }
        const korean = normalizeKorean(entry.korean.split(/[/,;]/).find((p) => koreanKey(p.replace(/[()[\]]/g, "")) === key) ?? entry.korean);
        const values = { korean, meaning: entry.meaning ?? null, topic: entry.topic ?? null, pictureHash: processed.hash, updatedAt: now };
        tx.insert(pictureLibrary)
          .values({ koreanKey: key, ...values })
          .onConflictDoUpdate({ target: pictureLibrary.koreanKey, set: values })
          .run();
        if (old) result.updated++;
        else result.added++;
      }
    });
  }
  if (touched.size) {
    result.cardsUpdated = applyLibrary(db, [...touched]);
    prunePictures(db);
  }
  result.total = librarySize(db);
  return result;
}

export function librarySize(db: Db): number {
  return db.select({ n: sql<number>`count(*)` }).from(pictureLibrary).get()!.n;
}

// ---------- A card's own picture ----------

/**
 * Sets a card's picture: its own (already processed), the library's, or none at all. Returns the
 * card's new reference, or undefined when the card isn't the user's.
 */
export function setCardPicture(
  db: Db,
  userId: number,
  cardId: number,
  choice: { own: Processed; hasText: boolean } | "library" | "none",
  now = new Date(),
): { picture: CardPictureRef | null } | undefined {
  return db.transaction((tx) => {
    const card = tx.select({ id: cards.id, key: cards.koreanKey }).from(cards).where(and(eq(cards.id, cardId), eq(cards.userId, userId))).get();
    if (!card) return undefined;
    const picture =
      choice === "none"
        ? ({ from: "none" } as const)
        : choice === "library"
          ? libraryPictureFor(tx as unknown as Db, card.key)
          : storePicture(tx as unknown as Db, choice.own, choice.hasText, "own", now);
    tx.update(cards).set({ picture, updatedAt: now }).where(eq(cards.id, cardId)).run();
    prunePictures(tx as unknown as Db);
    return { picture };
  });
}

/** Marks whether a card's current picture has the word written on it. */
export function setPictureHasText(db: Db, userId: number, cardId: number, hasText: boolean): boolean {
  const card = db.select({ picture: cards.picture }).from(cards).where(and(eq(cards.id, cardId), eq(cards.userId, userId))).get();
  if (!card?.picture || card.picture.from === "none") return false;
  db.update(pictures).set({ hasText }).where(eq(pictures.hash, card.picture.hash)).run();
  refreshHasText(db, card.picture.hash, hasText);
  return true;
}

// ---------- Fetching a picture from the web (for Claude) ----------

const PRIVATE_V4 = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xe0000000, 3],
] as const;

/** Loopback, private, link-local, multicast and other addresses a server must never be sent to. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const n = address.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
    return PRIVATE_V4.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));
  }
  const a = address.toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith("ff") || a.startsWith("64:ff9b") || a.startsWith("2001:db8");
}

type Resolver = (host: string) => Promise<string[]>;
const resolveAll: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

/**
 * Downloads a picture for Claude from a public https address: no private hosts (checked on every
 * redirect), at most MAX_INPUT_BYTES, within 15 seconds.
 */
export async function fetchPicture(url: string, opts: { resolve?: Resolver; fetchImpl?: typeof fetch } = {}): Promise<Buffer> {
  const resolve = opts.resolve ?? resolveAll;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(15_000);
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new PictureError("not a valid URL");
    }
    if (parsed.protocol !== "https:") throw new PictureError("only https addresses");
    if (parsed.username || parsed.password) throw new PictureError("no credentials in the URL");
    if (parsed.port && parsed.port !== "443") throw new PictureError("only the standard https port");
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
    if (!addresses.length) throw new PictureError(`cannot resolve ${host}`);
    if (addresses.some(isPrivateAddress)) throw new PictureError("that address is not public");
    const res = await fetchImpl(parsed, { redirect: "manual", signal, headers: { accept: "image/*" } }).catch(() => {
      throw new PictureError("could not download the picture");
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, parsed).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new PictureError(`the address answered ${res.status}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_INPUT_BYTES) throw new PictureError("the picture is over 8 MB");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_INPUT_BYTES) throw new PictureError("the picture is over 8 MB");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new PictureError("too many redirects");
}
