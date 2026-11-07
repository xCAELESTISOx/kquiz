import type { RatingName } from "./types";

// Typing the word in Hangul: by its sound, by its translation, into an example. The answer is checked
// syllable by syllable, and a wrong syllable is told apart down to its letters (ㅓ for ㅗ, a missing
// 받침), since that is where the word was misremembered or misheard.

const INITIALS = [..."ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"];
const VOWELS = [..."ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"];
const FINALS = ["", ..."ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"];

/** A syllable's letters: initial, vowel and final ("" when there is none). Undefined for anything else. */
export function letters(syllable: string): [string, string, string] | undefined {
  const code = syllable.charCodeAt(0) - 0xac00;
  if (syllable.length !== 1 || code < 0 || code > 11171) return undefined;
  return [INITIALS[Math.floor(code / 588)]!, VOWELS[Math.floor((code % 588) / 28)]!, FINALS[code % 28]!];
}

/** Punctuation and spacing don't count: 안녕하세요! = 안녕 하세요. */
function syllables(text: string): string[] {
  return [...text.normalize("NFC").replace(/[\s.,!?~…'"·-]/g, "")];
}

export type MarkStatus = "ok" | "wrong" | "missing";

export interface TypingCheck {
  correct: boolean;
  /** Off by one letter in one syllable: a slip, not a different word. */
  almost: boolean;
  /** The expected word, syllable by syllable, as the typed answer got it. */
  marks: { text: string; status: MarkStatus }[];
  /** What went wrong, in words: "ㅓ вместо ㅗ", "лишний слог 요". */
  slips: string[];
}

type Op = { kind: "ok" | "sub"; expected: string; typed: string } | { kind: "missing"; expected: string } | { kind: "extra"; typed: string };

/** Levenshtein over syllables, a near miss (same initial or vowel) counting cheaper than a different one. */
function align(expected: string[], typed: string[]): Op[] {
  const cost = (a: string, b: string) => {
    if (a === b) return 0;
    const [x, y] = [letters(a), letters(b)];
    return x && y && x.filter((l, i) => l === y[i]).length >= 2 ? 0.6 : 1;
  };
  const d = Array.from({ length: expected.length + 1 }, (_, i) => Array.from({ length: typed.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= expected.length; i++)
    for (let j = 1; j <= typed.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost(expected[i - 1]!, typed[j - 1]!));
  const ops: Op[] = [];
  let [i, j] = [expected.length, typed.length];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + cost(expected[i - 1]!, typed[j - 1]!)) {
      const [e, t] = [expected[--i]!, typed[--j]!];
      ops.push({ kind: e === t ? "ok" : "sub", expected: e, typed: t });
    } else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) ops.push({ kind: "missing", expected: expected[--i]! });
    else ops.push({ kind: "extra", typed: typed[--j]! });
  }
  return ops.reverse();
}

function describe(expected: string, typed: string): string[] {
  const [e, t] = [letters(expected), letters(typed)];
  if (!e || !t) return [`${typed} вместо ${expected}`];
  return e.flatMap((letter, i) => {
    if (letter === t[i]) return [];
    if (i === 2 && !t[2]) return [`нет 받침 ${letter} в ${expected}`];
    if (i === 2 && !letter) return [`лишний 받침 ${t[2]} в ${typed}`];
    return [`${t[i]} вместо ${letter}`];
  });
}

export function checkTyped(expected: string, typed: string): TypingCheck {
  const ops = align(syllables(expected), syllables(typed));
  const marks: TypingCheck["marks"] = [];
  const slips: string[] = [];
  let letterSlips = 0;
  for (const op of ops) {
    if (op.kind === "ok") marks.push({ text: op.expected, status: "ok" });
    else if (op.kind === "sub") {
      marks.push({ text: op.expected, status: "wrong" });
      const said = describe(op.expected, op.typed);
      letterSlips += said.length;
      slips.push(...said);
    } else if (op.kind === "missing") {
      marks.push({ text: op.expected, status: "missing" });
      slips.push(`пропущен слог ${op.expected}`);
      letterSlips += 3;
    } else {
      slips.push(`лишний слог ${op.typed}`);
      letterSlips += 3;
    }
  }
  const correct = ops.every((op) => op.kind === "ok");
  return { correct, almost: !correct && letterSlips === 1, marks, slips };
}

/** Right is good, a one-letter slip is hard, anything else is again. */
export function typingRating(check: TypingCheck): RatingName {
  return check.correct ? "good" : check.almost ? "hard" : "again";
}

/** Latin letters where Hangul was asked for: the Korean keyboard is not on. */
export function wrongKeyboard(typed: string): boolean {
  return /[a-z]/i.test(typed) && !/\p{Script=Hangul}/u.test(typed);
}

/**
 * Marks for showing: neighbouring syllables that went wrong become one highlight, so their
 * backgrounds don't overlap. A run with any wrong syllable shows as wrong, otherwise as missing.
 */
export function joinMarks(marks: TypingCheck["marks"]): TypingCheck["marks"] {
  const out: TypingCheck["marks"] = [];
  for (const mark of marks) {
    const last = out.at(-1);
    if (last && last.status !== "ok" && mark.status !== "ok") {
      last.text += mark.text;
      if (mark.status === "wrong") last.status = "wrong";
    } else out.push({ ...mark });
  }
  return out;
}
