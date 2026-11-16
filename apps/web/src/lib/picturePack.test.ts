import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { batches, BATCH_ENTRIES, parseCsv, readPack, toBase64 } from "./picturePack";

const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

describe("picture packs", () => {
  it("reads cards.json with its pictures, in a folder or not", () => {
    const zip = zipSync({
      "pack/cards.json": strToU8(
        JSON.stringify([
          { ko: "지하철", ru: "метро", topic_ru: "Транспорт", image: "images/a.png", has_text: true },
          { ko: "고양이", ru: "кошка", image: "images/missing.png" },
        ]),
      ),
      "pack/images/a.png": png,
      "__MACOSX/pack/images/._a.png": png,
    });
    const { words, skipped } = readPack(zip);
    expect(words).toEqual([{ korean: "지하철", meaning: "метро", topic: "Транспорт", hasText: true, file: png }]);
    expect(skipped).toEqual(["고양이"]);
  });

  it("reads cards.csv when there's no JSON", () => {
    const zip = zipSync({ "cards.csv": strToU8('﻿ko,ru,image\n아내/와이프,"жена, супруга",x.png\n'), "x.png": png });
    expect(readPack(zip).words[0]).toMatchObject({ korean: "아내/와이프", meaning: "жена, супруга" });
  });

  it("says what's wrong with a file that isn't a pack", () => {
    expect(() => readPack(strToU8("hello"))).toThrow(/zip/);
    expect(() => readPack(zipSync({ "a.png": png }))).toThrow(/cards\.json/);
  });

  it("parses quoted CSV fields", () => {
    expect(parseCsv('a,b\n"x, ""y""",2\r\n')).toEqual([{ a: 'x, "y"', b: "2" }]);
  });

  it("keeps each batch under the body limit and the entry cap", () => {
    const big = { file: new Uint8Array(500_000) };
    expect(batches([big, big, big]).map((b) => b.length)).toEqual([1, 1, 1]);
    const small = Array.from({ length: BATCH_ENTRIES + 5 }, () => ({ file: new Uint8Array(100) }));
    expect(batches(small).map((b) => b.length)).toEqual([BATCH_ENTRIES, 5]);
  });

  it("encodes base64 like btoa does", () => {
    expect(toBase64(strToU8("KQuiz"))).toBe(btoa("KQuiz"));
  });
});
