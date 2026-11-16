import { unzipSync } from "fflate";

// A picture pack: a .zip with cards.json (or cards.csv) listing words and the picture of each,
// e.g. [{"ko": "지하철", "ru": "метро", "topic_ru": "Транспорт", "image": "images/p7_01.png"}].
// The app reads it on the device and sends it to the server in batches, each under the body limit.

/** One word of a pack as the server takes it: the picture as base64. */
export interface PackEntry {
  korean: string;
  meaning?: string;
  topic?: string;
  hasText?: boolean;
  data: string;
}

/** A word of the pack before its picture is read. */
export interface PackWord {
  korean: string;
  meaning?: string;
  topic?: string;
  hasText?: boolean;
  file: Uint8Array;
}

const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;
/** Under the server's 1 MB body limit with room for JSON. */
export const BATCH_BYTES = 800_000;
export const BATCH_ENTRIES = 50;

type Row = Record<string, unknown>;

const text = (row: Row, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
};

/** Minimal CSV: quoted fields, commas and newlines inside quotes, a BOM. */
export function parseCsv(source: string): Row[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const input = source.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((cells) => Object.fromEntries(head.map((name, i) => [name.trim(), cells[i] ?? ""])));
}

const truthy = (value: unknown) => value === true || value === "true" || value === "1" || value === 1;

/** Reads a pack: the words with their pictures, and lines that couldn't be used. */
export function readPack(zip: Uint8Array): { words: PackWord[]; skipped: string[] } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, { filter: (f) => !f.name.startsWith("__MACOSX/") && (IMAGE.test(f.name) || /(^|\/)cards\.(json|csv)$/i.test(f.name)) });
  } catch {
    throw new Error("This isn't a zip file.");
  }
  const names = Object.keys(files);
  const listName = names.find((n) => /(^|\/)cards\.json$/i.test(n)) ?? names.find((n) => /(^|\/)cards\.csv$/i.test(n));
  if (!listName) throw new Error("No cards.json or cards.csv in the pack.");
  const base = listName.slice(0, listName.lastIndexOf("/") + 1);
  const source = new TextDecoder().decode(files[listName]);
  let rows: Row[];
  try {
    rows = listName.endsWith(".csv") ? parseCsv(source) : (JSON.parse(source) as Row[]);
  } catch {
    throw new Error(`${listName} can't be read.`);
  }
  if (!Array.isArray(rows)) throw new Error(`${listName} should be a list of words.`);
  const words: PackWord[] = [];
  const skipped: string[] = [];
  // A word listed twice (under two topics) keeps its first picture.
  const seen = new Set<string>();
  for (const row of rows) {
    const korean = text(row, "ko", "korean", "word");
    const image = text(row, "image", "picture", "file");
    const file = image ? (files[base + image] ?? files[image]) : undefined;
    if (!korean || !file) {
      skipped.push(korean ?? image ?? JSON.stringify(row).slice(0, 40));
      continue;
    }
    if (seen.has(korean)) continue;
    seen.add(korean);
    words.push({
      korean,
      meaning: text(row, "meaning", "ru", "translation"),
      topic: text(row, "topic", "topic_ru"),
      hasText: truthy(row.hasText ?? row.has_text),
      file,
    });
  }
  return { words, skipped };
}

/** Splits words into batches that each fit one request. */
export function batches<T extends { file: Uint8Array }>(words: T[]): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const word of words) {
    const bytes = Math.ceil(word.file.length / 3) * 4 + 200;
    if (current.length && (size + bytes > BATCH_BYTES || current.length >= BATCH_ENTRIES)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(word);
    size += bytes;
  }
  if (current.length) out.push(current);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Pictures too big for one request are shrunk on the device first (the server shrinks them anyway). */
export async function fitForUpload(file: Uint8Array, maxBytes = 600_000): Promise<Uint8Array> {
  if (file.length <= maxBytes) return file;
  const bitmap = await createImageBitmap(new Blob([file as Uint8Array<ArrayBuffer>]));
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return new Uint8Array(await blob.arrayBuffer());
}
