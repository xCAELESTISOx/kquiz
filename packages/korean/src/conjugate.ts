// Conjugation by rule. A form is built from the dictionary form, the word's class (regular or
// one of the irregular kinds) and an ending written the way textbooks write it: -아/어야,
// -(으)ㄹ, -고, -는/(으)ㄴ, -(스)ㅂ니다. Nothing here stores finished forms.

import { HONORIFIC, conjClass, takesNeun, type ConjClass, type Pos } from "./classes.js";
import { attach, lastSyllable, split, withLast } from "./hangul.js";

export interface Word {
  /** Dictionary form: 듣다. For the copula, the noun with 이다: 학생이다, 의사이다. */
  lemma: string;
  /** Defaults to verb. Matters for -는/(으)ㄴ, -ㄴ/는다, -다고. */
  pos?: Pos;
  /** Overrides the class worked out from the spelling and the built-in list. */
  cls?: ConjClass;
  /** Picks the wrong one of 아/어. Only for building plausible mistakes. */
  flip?: boolean;
  /** Keeps the word itself where an honorific verb would replace it (먹으세요, not 드세요). */
  ownHonorific?: boolean;
}

/** A finished form and the other spellings that are just as right (보아/봐, 되어/돼). */
export interface Form {
  form: string;
  alts: string[];
}

interface Resolved {
  lemma: string;
  stem: string;
  pos: Pos;
  cls: ConjClass;
  flip: boolean;
  ownHonorific?: boolean;
}

function resolve(w: Word): Resolved {
  if (w.ownHonorific) return { ...resolve({ ...w, ownHonorific: false }), ownHonorific: true };
  if (!w.lemma.endsWith("다")) throw new Error(`not a dictionary form: ${w.lemma}`);
  const pos = w.pos ?? (w.lemma === "아니다" ? "adjective" : "verb");
  const stem = w.lemma.slice(0, -1);
  if (pos === "copula") return { lemma: w.lemma, stem, pos, cls: "regular", flip: false };
  return { lemma: w.lemma, stem, pos, cls: w.cls ?? conjClass(w.lemma), flip: w.flip ?? false };
}

const one = (form: string, alts: string[] = []): Form => ({ form, alts: alts.filter((a) => a !== form) });
const map = (f: Form, fn: (s: string) => string): Form => one(fn(f.form), f.alts.map(fn));

const BRIGHT = new Set(["ㅏ", "ㅑ", "ㅗ", "ㅘ"]);
/** 아 after ㅏ ㅑ ㅗ, 어 after anything else. */
const harmony = (vowel: string, flip = false): "아" | "어" => (BRIGHT.has(vowel) !== flip ? "아" : "어");

/** The copula after a noun: 학생이다 → noun 학생, which ends in a consonant. */
function copulaNoun(r: Resolved): { noun: string; vowelEnd: boolean } {
  if (!r.stem.endsWith("이")) throw new Error(`a copula ends in 이다: ${r.lemma}`);
  const noun = r.stem.slice(0, -1);
  return { noun, vowelEnd: !lastSyllable(noun)?.final };
}

/** The 아/어 form ("infinitive"): 먹어, 가, 봐, 들어, 몰라, 해. Every 아/어 ending starts here. */
function infinitive(r: Resolved): Form {
  const { stem, cls } = r;
  if (r.pos === "copula") {
    const { noun, vowelEnd } = copulaNoun(r);
    return vowelEnd ? one(`${noun}여`, [`${noun}이어`]) : one(`${noun}이어`);
  }
  if (r.lemma === "아니다") return one("아니어", ["아녀"]);
  const last = lastSyllable(stem)!;
  const body = stem.slice(0, -1);
  switch (cls) {
    case "ha":
      return one(`${body}해`, [`${body}하여`]);
    case "b":
    case "b-o": {
      const bare = withLast(stem, { ...last, final: "" });
      return one(bare + (cls === "b-o" ? "와" : "워"));
    }
    case "d":
      return one(withLast(stem, { ...last, final: "ㄹ" }) + harmony(last.vowel, r.flip));
    case "s":
      return one(withLast(stem, { ...last, final: "" }) + harmony(last.vowel, r.flip));
    case "h": {
      const vowel = last.vowel === "ㅑ" ? "ㅒ" : "ㅐ";
      return one(withLast(stem, { ...last, final: "", vowel }));
    }
    case "reu": {
      // 모르 → 몰라: the syllable before 르 takes ㄹ, and 르 becomes 라/러.
      const prev = lastSyllable(body)!;
      return one(withLast(body, { ...prev, final: "ㄹ" }) + (harmony(prev.vowel, r.flip) === "아" ? "라" : "러"));
    }
    case "reo":
      return one(`${stem}러`);
    case "u":
      return one(withLast(stem, { ...last, vowel: "ㅓ" }));
    case "eu": {
      const prev = lastSyllable(body);
      const vowel = prev ? (harmony(prev.vowel, r.flip) === "아" ? "ㅏ" : "ㅓ") : "ㅓ";
      return one(withLast(stem, { ...last, vowel }));
    }
    default:
      break;
  }
  if (last.final) return one(stem + harmony(last.vowel, r.flip));
  // A vowel stem merges with 아/어.
  const contract = (vowel: string) => withLast(stem, { ...last, vowel });
  const plain = stem + harmony(last.vowel, r.flip);
  switch (last.vowel) {
    case "ㅏ":
    case "ㅓ":
    case "ㅕ":
      return one(stem);
    case "ㅐ":
    case "ㅔ":
      return one(stem, [plain]);
    case "ㅗ":
      // 오다, 나오다 → 와, 나와 (no 오아); 보다 → 봐 or 보아.
      return last.initial === "ㅇ" ? one(contract("ㅘ")) : one(contract("ㅘ"), [plain]);
    case "ㅜ":
      return one(contract("ㅝ"), [plain]);
    case "ㅣ":
      return one(contract("ㅕ"), [plain]);
    case "ㅚ":
      return one(contract("ㅙ"), [plain]);
    default:
      return one(plain);
  }
}

/** Puts ㅆ under the 아/어 form: 먹어 → 먹었, 해 → 했. */
function pastStem(r: Resolved): Form {
  return map(infinitive(r), (s) => attach(s, "ㅆ"));
}

/** The stem as 으-endings see it, and whether it ends in a vowel there. */
function euStem(r: Resolved, ending: string): { stem: string; vowel: boolean } {
  const { stem, cls } = r;
  const last = lastSyllable(stem)!;
  const bare = () => withLast(stem, { ...last, final: "" });
  switch (cls) {
    case "b":
    case "b-o":
      return { stem: `${bare()}우`, vowel: true };
    case "d":
      return { stem: withLast(stem, { ...last, final: "ㄹ" }), vowel: false };
    case "s":
      return { stem: bare(), vowel: false };
    case "h":
      return { stem: bare(), vowel: true };
    case "l":
      // ㄹ drops before ㄴ, ㄹ, ㅂ, ㅅ and never takes 으: 사세요, 살, 산, 삽니다, but 살면.
      return dropsL(ending) ? { stem: bare(), vowel: true } : { stem, vowel: true };
    default:
      return { stem, vowel: !last.final };
  }
}

function dropsL(ending: string): boolean {
  const head = ending[0] ?? "";
  if ("ㄴㄹㅂ".includes(head)) return true;
  const s = split(head);
  return Boolean(s && (s.initial === "ㄴ" || s.initial === "ㅅ"));
}

/** -(으)X: 먹으세요, 갈, 산, 들으면, 도우면, 지으세요, 그런. */
function withEu(r: Resolved, ending: string): Form {
  if (r.pos === "copula") {
    const { noun, vowelEnd } = copulaNoun(r);
    // 학생이면; 의사이면 or 의사면; 학생인, 의사인.
    const full = attach(`${noun}이`, ending);
    return vowelEnd && !/^[ㄴㄹㅁㅂ]/.test(ending) ? one(full, [noun + ending]) : one(full);
  }
  const honor = r.ownHonorific ? undefined : HONORIFIC[r.lemma];
  if (honor && /^[시세셨십셔실신]/.test(ending)) {
    // 드시다 already holds -시-: 드 + 세요, 드 + 셨어요. The word's own form stays right too.
    const base = honor.slice(0, -2);
    const swapped = withEu({ ...r, lemma: `${base}다`, stem: base, cls: conjClass(`${base}다`) }, ending);
    const own = withEu({ ...r, ownHonorific: true }, ending);
    return one(swapped.form, [own.form]);
  }
  const { stem, vowel } = euStem(r, ending);
  if (vowel) return one(attach(stem, ending));
  return one(attach(`${stem}으`, ending));
}

/** -고, -지, -기, -게, -는, -네요: straight on the stem; ㄹ drops before ㄴ. */
function withPlain(r: Resolved, ending: string): Form {
  if (r.pos === "copula") return one(`${r.stem}${ending}`);
  if (r.cls === "l" && /^[는네니나]/.test(ending)) {
    const last = lastSyllable(r.stem)!;
    return one(withLast(r.stem, { ...last, final: "" }) + ending);
  }
  return one(r.stem + ending);
}

/** -(스)ㅂ니다 / -(스)ㅂ니까: 갑니다, 삽니다, 먹습니다, 학생입니다. */
function formal(r: Resolved, rest: string): Form {
  if (r.pos === "copula") return one(attach(r.stem, `ㅂ${rest}`));
  if (r.cls === "l") {
    const last = lastSyllable(r.stem)!;
    return one(attach(withLast(r.stem, { ...last, final: "" }), `ㅂ${rest}`));
  }
  return lastSyllable(r.stem)!.final ? one(`${r.stem}습${rest}`) : one(attach(r.stem, `ㅂ${rest}`));
}

/** 해요체 present: 먹어요, 가요, 학생이에요, 의사예요, 아니에요. */
function polite(r: Resolved): Form {
  if (r.pos === "copula") {
    const { noun, vowelEnd } = copulaNoun(r);
    return one(vowelEnd ? `${noun}예요` : `${noun}이에요`);
  }
  if (r.lemma === "아니다") return one("아니에요", ["아니어요"]);
  return map(infinitive(r), (s) => `${s}요`);
}

/** Written plain style: 간다, 먹는다, 산다; adjectives keep the dictionary form. */
function plainPresent(r: Resolved, rest = ""): Form {
  if (r.pos !== "verb") return one(`${r.stem}다${rest}`);
  const { stem, vowel } = euStem({ ...r, cls: r.cls === "l" ? "l" : "regular" }, "ㄴ");
  return vowel ? one(attach(stem, `ㄴ다${rest}`)) : one(`${r.stem}는다${rest}`);
}

/** -는 for verbs (and 있다/없다), -(으)ㄴ for adjectives and the copula. */
function attributive(r: Resolved, rest: string): Form {
  if (r.pos !== "copula" && takesNeun(r.lemma, r.pos)) return withPlain(r, `는${rest}`);
  return withEu(r, `ㄴ${rest}`);
}

/**
 * One ending on one word. Endings are written as in textbooks, with or without the leading
 * hyphen: 아/어서, 았/었어요, (으)ㄹ, (으)세요, 고, 기로, 는/(으)ㄴ, ㄴ/는다, (스)ㅂ니다, 다고, 요.
 */
export function inflect(word: Word, ending: string): Form {
  const r = resolve(word);
  const e = ending.replace(/^-/, "").trim();
  let m: RegExpMatchArray | null;
  if ((m = e.match(/^(?:아\/어|어\/아|여)(.*)$/))) return map(infinitive(r), (s) => s + m![1]);
  if ((m = e.match(/^(?:았\/었|었\/았|였)(.*)$/))) return map(pastStem(r), (s) => s + m![1]);
  if ((m = e.match(/^(?:\(스\)ㅂ|ㅂ\/습|습\/ㅂ)(니다|니까|니다만)$/))) return formal(r, m[1]!);
  if ((m = e.match(/^(?:는\/\(으\)ㄴ|\(으\)ㄴ\/는)(.*)$/))) return attributive(r, m[1]!);
  if ((m = e.match(/^(?:ㄴ\/는|는\/ㄴ)다(.*)$/))) return plainPresent(r, m[1]!);
  if ((m = e.match(/^\(으\)(.+)$/))) return withEu(r, m[1]!);
  if (e === "요") return polite(r);
  if (e === "다") return r.pos === "verb" ? plainPresent(r) : one(r.lemma);
  if ((m = e.match(/^다고(.*)$/))) {
    if (r.pos === "copula") {
      const { noun, vowelEnd } = copulaNoun(r);
      return vowelEnd ? one(`${noun}라고${m[1]}`, [`${noun}이라고${m[1]}`]) : one(`${noun}이라고${m[1]}`);
    }
    return plainPresent(r, `고${m[1]}`);
  }
  return withPlain(r, e);
}

/** How the last predicate of a sentence ends. */
export type Style = "formal" | "polite" | "plain";
export type Tense = "present" | "past";

export interface Final {
  style?: Style;
  tense?: Tense;
  question?: boolean;
  /** Any other ending for the last predicate instead: 아/어서, 았/었는데, (으)ㄹ 때. */
  ending?: string;
}

export function finish(word: Word, final: Final = {}): Form {
  if (final.ending) return inflect(word, final.ending);
  const style = final.style ?? "formal";
  const past = final.tense === "past";
  if (style === "formal") return inflect(word, past ? `았/었${final.question ? "습니까" : "습니다"}` : `(스)ㅂ${final.question ? "니까" : "니다"}`);
  if (style === "polite") return past ? inflect(word, "았/었어요") : inflect(word, "요");
  return past ? inflect(word, "았/었다") : inflect(word, "다");
}


