import { describe, expect, it } from "vitest";
import { initials, isInitialsQuery, spellOut } from "./hangulSearch.js";

describe("hangul search", () => {
  it("spells syllables out letter by letter, compound letters split", () => {
    expect(spellOut("학교")).toBe("ㅎㅏㄱㄱㅛ");
    expect(spellOut("닭")).toBe("ㄷㅏㄹㄱ");
    expect(spellOut("과")).toBe("ㄱㅗㅏ");
    expect(spellOut("Яблоко")).toBe("яблоко");
  });

  it("makes an unfinished syllable a prefix of the word", () => {
    for (const [typed, word] of [["하", "학교"], ["학", "학교"], ["ㅎ", "학교"], ["다", "닭"], ["달", "닭"], ["고", "과일"]]) {
      expect(spellOut(word).startsWith(spellOut(typed!)), `${typed} → ${word}`).toBe(true);
    }
  });

  it("takes initials", () => {
    expect(initials("학교 가요")).toBe("ㅎㄱㄱㅇ");
    expect(isInitialsQuery("ㅎㄱ")).toBe(true);
    expect(isInitialsQuery("ㅎ ㄲ")).toBe(true);
    expect(isInitialsQuery("하ㄱ")).toBe(false);
    expect(isInitialsQuery("ㅏ")).toBe(false);
  });
});
