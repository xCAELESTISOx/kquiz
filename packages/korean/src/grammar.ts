// Grammar constructions over the conjugation rules. A construction is written the way a
// textbook writes it — "-아/어야 하다", "-(으)ㄹ 수 있다", "-는 이유", "못" — and a sentence keeps
// only the dictionary form and the construction. The finished form, the spellings that are just
// as right, and the plausible wrong forms are all built here.

import { conjClass, type ConjClass, type Pos } from "./classes.js";
import { finish, inflect, type Final, type Form, type Word } from "./conjugate.js";
import { lastSyllable } from "./hangul.js";

interface Parsed {
  /** Words before the verb: 못, 안. */
  prefix: string[];
  /** The ending on the verb itself, when the construction has one. */
  ending: string | null;
  /** Words after the verb. The last one, when it is a predicate, takes the sentence ending. */
  rest: string[];
  /** The trailing predicate (하다, 있다, 보다), if any. */
  aux: string | null;
}

export function parse(pattern: string): Parsed {
  const tokens = pattern.trim().split(/\s+/).filter(Boolean);
  const at = tokens.findIndex((t) => t.startsWith("-"));
  if (at < 0) return { prefix: tokens, ending: null, rest: [], aux: null };
  let ending = tokens[at]!;
  const rest = tokens.slice(at + 1);
  // -아/어지다 is one word: the ending and the helper 지다 written together.
  const glued = ending.match(/^(-(?:아\/어|어\/아))지다$/);
  if (glued) {
    ending = glued[1]!;
    rest.push("지다");
  }
  const tail = rest.at(-1);
  const aux = tail && /^[가-힣]+다$/.test(tail) ? tail : null;
  return { prefix: tokens.slice(0, at), ending, rest: aux ? rest.slice(0, -1) : rest, aux };
}

// Helpers in a construction that act like adjectives (수 있다 → 있다, 기 좋다).
const AUX_ADJECTIVES = new Set(["있다", "없다", "좋다", "싫다", "같다", "쉽다", "어렵다", "괜찮다"]);
// Helpers that may be written together with -아/어 (먹어 보다 / 먹어보다).
const MAY_ATTACH = new Set(["보다", "주다", "버리다", "놓다", "두다", "가다", "오다", "있다", "드리다", "내다"]);

// Verbs that end in 이다 after a consonant but are not "noun + 이다".
const I_VERBS = new Set(["줄이다", "높이다", "먹이다", "붙이다", "죽이다", "끓이다", "속이다", "숙이다", "움직이다", "늘이다", "들이다", "녹이다"]);

function auxWord(aux: string): Word {
  if (AUX_ADJECTIVES.has(aux)) return { lemma: aux, pos: "adjective" };
  // 전망이다, 것이다, 예정이다: a noun with the copula.
  const before = aux.length > 2 ? lastSyllable(aux.slice(0, -2)) : null;
  if (aux.endsWith("이다") && before?.final && !I_VERBS.has(aux)) return { lemma: aux, pos: "copula" };
  return { lemma: aux, pos: "verb" };
}

/** At most this many spellings per form, so a pile of optional contractions stays small. */
const MAX_ALTS = 8;

function combine(parts: Form[], joins: string[]): Form {
  let out = [parts[0]!.form, ...parts[0]!.alts];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]!;
    const next: string[] = [];
    for (const left of out) for (const right of [p.form, ...p.alts]) next.push(left + joins[i - 1] + right);
    out = next.slice(0, 64);
  }
  const [form, ...alts] = out;
  return { form: form!, alts: [...new Set(alts)].filter((a) => a !== form).slice(0, MAX_ALTS) };
}

export interface Built extends Form {
  /** The other spellings with the helper written together or apart, where both are allowed. */
  spacing: string[];
}

/**
 * Builds the construction on a word: build({lemma: "듣다"}, "-아/어야 하다") → 들어야 합니다.
 * `final` sets how the last predicate ends (합니다체 present by default).
 */
export function build(word: Word, pattern: string, final: Final = {}): Built {
  const p = parse(pattern);
  if (word.pos === "noun") return buildNoun(word.lemma, p, final, false);
  const parts: Form[] = [];
  const joins: string[] = [];
  let prefix = p.prefix.join(" ");
  let verb = word;

  // 못/안 with a noun + 하다 verb goes before 하다: 연락 못 했습니다.
  if (prefix && (word.cls ?? safeClass(word.lemma)) === "ha" && word.lemma.length > 2) {
    const noun = word.lemma.slice(0, -2);
    prefix = `${noun} ${prefix}`;
    verb = { ...word, lemma: "하다" };
  }

  const main = p.ending ? inflect(verb, p.ending) : finish(verb, final);
  if (prefix) {
    parts.push({ form: prefix, alts: [] });
    joins.push(" ");
  }
  parts.push(main);
  for (const word of p.rest) {
    joins.push(" ");
    parts.push({ form: word, alts: [] });
  }
  let spacingOk = false;
  if (p.aux) {
    const helper = finish(auxWord(p.aux), final);
    const bare = /^-?(아\/어|어\/아)$/.test(p.ending ?? "");
    // -아/어지다 is always one word; other helpers after -아/어 may be written either way.
    if (bare && p.aux === "지다") joins.push("");
    else {
      joins.push(" ");
      spacingOk = bare && MAY_ATTACH.has(p.aux) && p.rest.length === 0;
    }
    parts.push(helper);
  }
  const built = combine(parts, joins);
  const spacing = spacingOk ? [built.form, ...built.alts].map(joinLast) : [];
  return { ...built, spacing: spacing.filter((s) => s !== built.form) };
}

/**
 * A particle on a noun, with the 받침 pairs chosen by the noun: 회의를 / 선거을 → 선거를,
 * 발표에 따르면, 1년 만에, 서울로 / 부산으로. `wrong` picks the other one of each pair.
 */
export function particle(noun: string, token: string, wrong = false): string {
  const t = token.replace(/^-/, "");
  const last = lastSyllable(noun);
  // Digits and Latin letters: read as written is unknown, so take the consonant forms as a guess.
  const final = last ? Boolean(last.final) !== wrong : !wrong;
  const pair = t.match(/^(을\/를|를\/을|이\/가|가\/이|은\/는|는\/은|과\/와|와\/과)(.*)$/);
  if (pair) {
    const [a, b] = pair[1]!.split("/") as [string, string];
    const consonant = "을이은과".includes(a) ? a : b;
    const vowel = consonant === a ? b : a;
    return noun + (final ? consonant : vowel) + pair[2];
  }
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^\(으\)로(.*)$/))) {
    const ro = last?.final === "ㄹ" ? !wrong : !final;
    return noun + (ro ? "로" : "으로") + m[1];
  }
  if ((m = t.match(/^\(이\)(.*)$/))) return noun + (final ? "이" : "") + m[1];
  return noun + t;
}

function buildNoun(noun: string, p: Parsed, final: Final, wrong: boolean): Built {
  // With no "-" ending the words follow the noun: 1년 만에.
  const head = (p.ending ? [...p.prefix, particle(noun, p.ending, wrong), ...p.rest] : [noun, ...p.prefix]).join(" ");
  if (!p.aux) return { form: head, alts: [], spacing: [] };
  const helper = finish(auxWord(p.aux), final);
  return { form: `${head} ${helper.form}`, alts: helper.alts.map((a) => `${head} ${a}`), spacing: [] };
}

/** 먹어 봤습니다 → 먹어봤습니다. */
function joinLast(s: string): string {
  const i = s.lastIndexOf(" ");
  return i < 0 ? s : s.slice(0, i) + s.slice(i + 1);
}

function safeClass(lemma: string): ConjClass | null {
  try {
    return conjClass(lemma);
  } catch {
    return null;
  }
}

export type MistakeKind =
  | "irregular" // the irregular change is left out: 듣어야
  | "not-irregular" // a regular word treated as irregular: 입다 → 이워야
  | "harmony" // the wrong one of 아/어: 들아야
  | "eu" // 으 left out after a consonant: 먹세요
  | "l" // ㄹ kept or 으 added on a ㄹ stem: 살는, 살으세요
  | "particle"; // the wrong one of a particle pair: 선거을

export interface Mistake {
  form: string;
  kind: MistakeKind;
}

const IRREGULAR: ConjClass[] = ["b", "b-o", "d", "s", "h", "reu", "reo", "u"];
const LOOKALIKE: Record<string, ConjClass> = { ㅂ: "b", ㄷ: "d", ㅅ: "s" };

/** Wrong forms a learner is likely to produce, each with what went wrong. Never the right one. */
export function mistakes(word: Word, pattern: string, final: Final = {}): Mistake[] {
  const right = build(word, pattern, final);
  const taken = new Set([right.form, ...right.alts, ...right.spacing]);
  const out: Mistake[] = [];
  const tryOne = (w: Word, kind: MistakeKind, p = pattern) => {
    try {
      const f = build(w, p, final).form;
      if (!taken.has(f)) {
        taken.add(f);
        out.push({ form: f, kind });
      }
    } catch {
      // Some wrong shapes can't even be written (먹 + ㄹ); skip them.
    }
  };
  if (word.pos === "noun") {
    const f = buildNoun(word.lemma, parse(pattern), final, true).form;
    return taken.has(f) ? [] : [{ form: f, kind: "particle" }];
  }
  if (word.pos === "copula") return out;
  const cls = word.cls ?? safeClass(word.lemma);
  if (!cls) return out;
  if (IRREGULAR.includes(cls)) tryOne({ ...word, cls: cls === "reu" ? "eu" : "regular" }, "irregular");
  const final0 = lastSyllable(word.lemma.slice(0, -1))?.final ?? "";
  if (cls === "regular" && LOOKALIKE[final0]) tryOne({ ...word, cls: LOOKALIKE[final0] }, "not-irregular");
  tryOne({ ...word, flip: true }, "harmony");
  if (cls === "l") tryOne({ ...word, cls: "regular" }, "l");
  if (/\(으\)/.test(pattern) && cls !== "l") tryOne(word, "eu", pattern.replace("(으)", ""));
  return out;
}

export type Check = "right" | "spacing" | "wrong";

const tidy = (s: string) => s.normalize("NFC").trim().replace(/[.?!,…~]+$/u, "").replace(/\s+/g, " ");

/** Compares a typed answer with a built form. "spacing" is right apart from the spaces. */
export function check(answer: string, built: Built): Check {
  const a = tidy(answer);
  const ok = [built.form, ...built.alts, ...built.spacing].map(tidy);
  if (ok.includes(a)) return "right";
  const squash = (s: string) => s.replace(/\s/g, "");
  return ok.some((o) => squash(o) === squash(a)) ? "spacing" : "wrong";
}

/** One line on how the word changes, for the intro table and for feedback on a mistake. */
export function rule(word: Word): string | null {
  if (word.pos === "noun") return null;
  const cls = word.pos === "copula" ? "regular" : (word.cls ?? safeClass(word.lemma));
  const show = (e: string) => inflect(word, e).form;
  const ex = () => `${word.lemma} → ${show("요")}, ${show("(으)ㄴ")}`;
  switch (cls) {
    case "b":
      return `ㅂ becomes 우 before a vowel: ${ex()}`;
    case "b-o":
      return `ㅂ becomes 오 before 아: ${ex()}`;
    case "d":
      return `ㄷ becomes ㄹ before a vowel: ${ex()}`;
    case "s":
      return `ㅅ drops before a vowel, nothing merges: ${ex()}`;
    case "h":
      return `ㅎ drops; before 아/어 the vowel becomes ㅐ: ${ex()}`;
    case "reu":
      return `르 becomes ㄹ + 라/러: ${word.lemma} → ${show("요")}`;
    case "reo":
      return `adds 러 before 어: ${word.lemma} → ${show("요")}`;
    case "u":
      return `ㅜ drops before 어: ${word.lemma} → ${show("요")}`;
    case "l":
      return `ㄹ drops before ㄴ, ㅂ, ㅅ and takes no 으: ${word.lemma} → ${show("는")}, ${show("(스)ㅂ니다")}, ${show("(으)세요")}`;
    case "eu":
      return `ㅡ drops before 아/어: ${word.lemma} → ${show("요")}`;
    default:
      return null;
  }
}

export type { Pos };
