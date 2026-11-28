// How a verb or adjective changes its stem. Some classes follow from the spelling (ㄹ, 으,
// 하다); the others can't be told apart from regular words (입다 is regular, 돕다 is not), so
// they come from the list below or from the card itself.

import { lastSyllable } from "./hangul.js";

export type ConjClass =
  | "regular"
  | "b" // ㅂ → 우: 춥다 → 추워요
  | "b-o" // ㅂ → 오: 돕다 → 도와요
  | "d" // ㄷ → ㄹ: 듣다 → 들어요
  | "s" // ㅅ drops: 짓다 → 지어요
  | "h" // ㅎ drops, vowel → ㅐ: 그렇다 → 그래요
  | "reu" // 르 → ㄹㄹ: 모르다 → 몰라요
  | "reo" // + 러: 이르다 (arrive) → 이르러요
  | "u" // ㅜ drops: 푸다 → 퍼요
  | "l" // ㄹ drops before ㄴ ㅂ ㅅ: 살다 → 사는, 삽니다
  | "eu" // ㅡ drops: 쓰다 → 써요
  | "ha"; // 하다 → 해요

/** noun: the construction goes on a noun with particles (-을/를 앞두고, -에 따르면). */
export type Pos = "verb" | "adjective" | "copula" | "noun";

/** Words that are irregular in a way the spelling doesn't show. */
const LISTED: Record<string, ConjClass> = {};
const add = (cls: ConjClass, words: string) => {
  for (const w of words.split(/\s+/).filter(Boolean)) LISTED[w] = cls;
};

add(
  "b",
  `춥다 덥다 쉽다 어렵다 가깝다 무겁다 가볍다 아름답다 즐겁다 반갑다 고맙다 귀엽다 무섭다 맵다 싱겁다
   부럽다 시끄럽다 더럽다 두껍다 차갑다 뜨겁다 아깝다 그립다 밉다 눕다 굽다 줍다 깁다 엷다 미덥다
   서럽다 사납다 날카롭다 너그럽다 간지럽다 노엽다 정답다 놀랍다 가렵다 어둡다 우습다 역겹다`,
);
add("b-o", "돕다 곱다");
add("d", "듣다 걷다 묻다 싣다 깨닫다 붇다 일컫다 긷다 엿듣다 알아듣다");
add("s", "짓다 낫다 붓다 잇다 긋다 젓다");
add("reo", "푸르다 노르다");
add("u", "푸다");
// 르-words that are regular (으 drops, no doubled ㄹ).
add("eu", "따르다 치르다 들르다 우러르다 다다르다");
// Look irregular by class but are regular.
add(
  "regular",
  `입다 잡다 좁다 씹다 뽑다 업다 접다 집다 받다 닫다 믿다 얻다 쏟다 뜯다 굳다 씻다 웃다 벗다 빼앗다
   솟다 좋다 놓다 넣다 낳다 쌓다 닿다 찧다`,
);

/** Endings that make a word irregular wherever it appears: 자연스럽다, 새롭다, 알아듣다. */
const SUFFIXES: [string, ConjClass][] = [
  ["스럽다", "b"],
  ["롭다", "b"],
  ["답다", "b"],
  ["듣다", "d"],
  ["걷다", "d"],
  ["깨닫다", "d"],
  ["짓다", "s"],
  ["돕다", "b-o"],
];

/** The class a word is conjugated with, unless the card says otherwise. */
export function conjClass(lemma: string): ConjClass {
  if (!lemma.endsWith("다") || lemma.length < 2) throw new Error(`not a dictionary form: ${lemma}`);
  const listed = LISTED[lemma];
  if (listed) return listed;
  for (const [suffix, cls] of SUFFIXES) if (lemma.endsWith(suffix) && lemma.length > suffix.length) return cls;
  const stem = lemma.slice(0, -1);
  if (stem.endsWith("하")) return "ha";
  const last = lastSyllable(stem);
  if (!last) throw new Error(`not Korean: ${lemma}`);
  if (last.final === "ㄹ") return "l";
  // 그렇다, 빨갛다, 하얗다, 어떻다: adjectives with a single ㅎ under a ㅓ/ㅏ/ㅑ syllable.
  if (last.final === "ㅎ" && /[렇랗갛얗맣떻]$/.test(stem)) return "h";
  if (!last.final && last.vowel === "ㅡ") return stem.endsWith("르") && stem.length > 1 ? "reu" : "eu";
  return "regular";
}

/** Honorific verbs that replace the plain one before -시-: 먹다 → 드시다. 있다 → 계시다 only
 * for people (시간 있으세요? stays), so it is left to the sentence. */
export const HONORIFIC: Record<string, string> = {
  먹다: "드시다",
  마시다: "드시다",
  자다: "주무시다",
  말하다: "말씀하시다",
};

/** Words whose attributive and connective forms go like a verb (있는, 맛있는데). */
export function takesNeun(lemma: string, pos: Pos): boolean {
  return pos === "verb" || lemma.endsWith("있다") || lemma.endsWith("없다");
}
