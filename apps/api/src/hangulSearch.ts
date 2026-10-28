// Search by letters, not syllables: while a word is being typed its last syllable is unfinished
// (하 on the way to 학교) and a syllable never equals its own start. So both the text and the query
// are spelled out letter by letter, compound letters split too (ㅘ = ㅗㅏ, ㄺ = ㄹㄱ), and matched
// as substrings. A query of consonants alone (ㅎㄱ) also matches the words' initials (학교).

const INITIALS = [..."ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"];
const VOWELS = [..."ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"];
const FINALS = ["", ..."ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"];

/** Letters typed as two keys on a Korean keyboard. Tense ㄲ ㄸ ㅃ ㅆ ㅉ are one key and stay whole. */
const COMPOUND: Record<string, string> = {
  ㄳ: "ㄱㅅ", ㄵ: "ㄴㅈ", ㄶ: "ㄴㅎ", ㄺ: "ㄹㄱ", ㄻ: "ㄹㅁ", ㄼ: "ㄹㅂ", ㄽ: "ㄹㅅ", ㄾ: "ㄹㅌ", ㄿ: "ㄹㅍ", ㅀ: "ㄹㅎ", ㅄ: "ㅂㅅ",
  ㅘ: "ㅗㅏ", ㅙ: "ㅗㅐ", ㅚ: "ㅗㅣ", ㅝ: "ㅜㅓ", ㅞ: "ㅜㅔ", ㅟ: "ㅜㅣ", ㅢ: "ㅡㅣ",
};

const CONSONANTS = new Set([...INITIALS, ...FINALS.filter(Boolean)]);

function syllableIndex(ch: string): number {
  const code = ch.charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 ? code : -1;
}

const split = (letter: string) => COMPOUND[letter] ?? letter;

/** Lower case, every Hangul syllable and compound letter spelled out: 왉 → ㅇㅗㅏㄹㄱ. Other text as is. */
export function spellOut(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC").toLocaleLowerCase()) {
    const code = syllableIndex(ch);
    if (code < 0) out += split(ch);
    else out += INITIALS[Math.floor(code / 588)]! + split(VOWELS[Math.floor((code % 588) / 28)]!) + split(FINALS[code % 28]!);
  }
  return out;
}

/** Each syllable's initial, spaces dropped, everything else as is: 학교 가요 → ㅎㄱㄱㅇ. */
export function initials(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC").replace(/\s+/g, "")) {
    const code = syllableIndex(ch);
    out += code < 0 ? ch : INITIALS[Math.floor(code / 588)]!;
  }
  return out;
}

/** ㅎㄱ: only consonant letters (spaces aside), so it may be the words' initials. */
export function isInitialsQuery(text: string): boolean {
  const letters = [...text.normalize("NFC").replace(/\s+/g, "")];
  return letters.length > 0 && letters.every((ch) => CONSONANTS.has(ch));
}
