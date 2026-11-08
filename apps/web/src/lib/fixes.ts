import type { ScoreResult } from "./types";

// "How to fix it" lines for the speech screen: one short articulation tip per wrong sound,
// written for an English speaker. Keyed by the jamo the scorer sends (services/scorer/app/phones.py).

type ScoreError = ScoreResult["errors"][number];

type Phonation = "lenis" | "aspirated" | "tense";

// Stops, affricates and ㅅ/ㅆ: the three-way contrast English does not have.
const SERIES: Record<string, { phonation: Phonation; place: string }> = {
  ㄱ: { phonation: "lenis", place: "k" },
  ㅋ: { phonation: "aspirated", place: "k" },
  ㄲ: { phonation: "tense", place: "k" },
  ㄷ: { phonation: "lenis", place: "t" },
  ㅌ: { phonation: "aspirated", place: "t" },
  ㄸ: { phonation: "tense", place: "t" },
  ㅂ: { phonation: "lenis", place: "p" },
  ㅍ: { phonation: "aspirated", place: "p" },
  ㅃ: { phonation: "tense", place: "p" },
  ㅈ: { phonation: "lenis", place: "c" },
  ㅊ: { phonation: "aspirated", place: "c" },
  ㅉ: { phonation: "tense", place: "c" },
  ㅅ: { phonation: "lenis", place: "s" },
  ㅆ: { phonation: "tense", place: "s" },
};

const PHONATION_FIX: Record<Phonation, Partial<Record<Phonation, string>>> = {
  lenis: {
    aspirated: "Softer, with hardly any push: {e} is relaxed, a light breath of air, not the puff of {h}.",
    tense: "Don't tighten your throat: {e} is soft and relaxed with a light breath, {h} is hard with no air.",
  },
  aspirated: {
    lenis: "Breathe out harder: {e} is like {like}, with a strong puff of air after it. A hand at your mouth should feel it.",
    tense: "Don't squeeze, breathe out: {e} has a strong puff of air after it, {h} has none.",
  },
  tense: {
    lenis: "Tighten your throat and say it with no breath, sharp and a bit higher: {e} is close to {like}, but tighter.",
    aspirated: "No breath: {e} is hard and tight, no air comes after it. A hand at your mouth should feel nothing.",
  },
};

// English sounds to compare with, by place: the aspirated stops sound like English initial k/t/p/ch,
// the tense ones like the unaspirated k/t/p after s ("sky", "stay", "spy").
const ENGLISH: Record<string, { aspirated?: string; tense: string }> = {
  k: { aspirated: "the k in “kite”", tense: "the k in “sky”" },
  t: { aspirated: "the t in “top”", tense: "the t in “stay”" },
  p: { aspirated: "the p in “pie”", tense: "the p in “spy”" },
  c: { aspirated: "the ch in “chip”", tense: "the tch in “catch”" },
  s: { tense: "the s in “see”" },
};

// Specific pairs, "expected>heard". Position-free unless the key starts with a position.
const PAIRS: Record<string, string> = {
  // Vowels English speakers mix up or do not have.
  "ㅓ>ㅗ": "Don't round your lips: ㅓ is open, jaw down, close to the u in “up”.",
  "ㅗ>ㅓ": "Round your lips and push them forward: ㅗ is narrow, close to “oh” with no glide.",
  "ㅗ>ㅜ": "Open a little more: ㅗ sits between “oh” and “oo”, lips rounded but not pursed.",
  "ㅜ>ㅗ": "Purse your lips and push them forward, as in “oo”.",
  "ㅜ>ㅡ": "Round your lips: ㅜ is “oo”, not the spread ㅡ.",
  "ㅡ>ㅜ": "Don't round your lips, spread them as in a smile: tongue as for “oo”, lips flat.",
  "ㅡ>ㅣ": "Pull your tongue back: ㅡ is not “ee”, though the lips stay spread.",
  "ㅡ>ㅓ": "Mouth almost closed, lips spread: ㅡ is narrow, not the open ㅓ.",
  "ㅓ>ㅡ": "Open your mouth wider: ㅓ drops the jaw, close to the u in “up”.",
  "ㅓ>ㅏ": "Open a little less and pull your tongue back: ㅓ is darker than “ah”.",
  "ㅏ>ㅓ": "Open your mouth wider: ㅏ is a clear “ah”, as in “father”.",
  "ㅔ>ㅣ": "Drop your jaw: ㅔ is the e in “bed”, not “ee”.",
  "ㅣ>ㅔ": "Narrow your mouth and spread your lips: ㅣ is a pure “ee”.",
  "ㅕ>ㅛ": "Don't round your lips: ㅕ = “y” + the open ㅓ, not “yo”.",
  "ㅛ>ㅕ": "Round your lips: ㅛ = “y” + the narrow ㅗ, close to “yo”.",
  "ㅝ>ㅗ": "Start with “oo” and open into ㅓ: ㅝ = oo + ㅓ, lips unrounded at the end.",
  "ㅢ>ㅣ": "Start with ㅡ, lips spread, and glide quickly into ㅣ.",
  "ㅢ>ㅡ": "Don't stop on ㅡ: glide quickly into “ee” at the end.",
  // Codas: Korean finals are held, never released.
  "coda:ㅇ>ㄴ": "Final ㅇ: tongue tip down, the back of the tongue against the palate, sound through the nose, like the ng in “sing”.",
  "coda:ㄴ>ㅇ": "Final ㄴ: tongue tip against the upper teeth, like the n in “sun”. Don't pull it back into “ng”.",
  "coda:ㅁ>ㄴ": "Close your lips at the end of the syllable: ㅁ ends it with the lips.",
  "coda:ㅁ>ㅇ": "Close your lips at the end of the syllable: ㅁ ends it with the lips.",
  "coda:ㄴ>ㅁ": "Don't close your lips: ㄴ is the tongue tip against the teeth.",
  "coda:ㅇ>ㄱ": "This sound is nasal: before ㄴ and ㅁ, ㄱ is read as ㅇ. Don't cut it off, let the air out through your nose.",
  "coda:ㄴ>ㄷ": "This sound is nasal: before ㄴ and ㅁ, ㄷ is read as ㄴ. Don't cut it off, let the air out through your nose.",
  "coda:ㅁ>ㅂ": "This sound is nasal: before ㄴ and ㅁ, ㅂ is read as ㅁ. Don't cut it off, let the air out through your nose.",
  "coda:ㄹ>ㄴ": "Final ㄹ: tongue tip pressed behind the upper teeth and kept there, a light “l”.",
};

// Fallbacks by the expected sound, when no pair above fits.
const VOWELS: Record<string, string> = {
  ㅏ: "ㅏ is a clear “ah”, mouth wide open.",
  ㅓ: "ㅓ: mouth open, lips not rounded, close to the u in “up”.",
  ㅗ: "ㅗ: lips rounded and pushed forward, a narrow “oh”, almost “oo”.",
  ㅜ: "ㅜ: lips pursed, like the oo in “moon”.",
  ㅡ: "ㅡ: lips spread as in a smile, tongue as for “oo”.",
  ㅣ: "ㅣ is a pure “ee”, lips spread.",
  ㅔ: "ㅔ is the e in “bed”; ㅐ and ㅔ sound the same today.",
  ㅑ: "ㅑ = a short “y” + “ah”.",
  ㅕ: "ㅕ = a short “y” + ㅓ, lips not rounded.",
  ㅛ: "ㅛ = a short “y” + the narrow ㅗ.",
  ㅠ: "ㅠ = a short “y” + “oo”, as in “you”.",
  ㅖ: "ㅖ = a short “y” + the e in “bed”.",
  ㅘ: "ㅘ = a short “w” + “ah”, in one syllable.",
  ㅚ: "ㅚ = a short “w” + the e in “bed”, in one syllable.",
  ㅝ: "ㅝ = a short “w” + ㅓ, in one syllable.",
  ㅟ: "ㅟ = a short “w” + “ee”, in one syllable.",
  ㅢ: "ㅢ: start with ㅡ and glide quickly into “ee”.",
};

const CONSONANTS: Record<string, string> = {
  ㅎ: "ㅎ is a light breath from the throat, like the h in “hat”.",
  ㅁ: "ㅁ: close your lips, as for “m”.",
  ㄴ: "ㄴ: tongue tip against the upper teeth, as for “n”.",
  ㅇ: "Final ㅇ: the back of the tongue against the palate, sound through the nose, like the ng in “sing”.",
  ㄹ: "ㄹ between vowels is one light tap of the tongue, like the tt in American “butter”.",
};

// Finals ㄱ ㄷ ㅂ are held and never released.
const CODA: Record<string, string> = {
  ㄱ: "Final ㄱ: press the back of your tongue to the palate and stop, no breath and no “uh” after it.",
  ㄷ: "Final ㄷ: press your tongue tip to the teeth and stop, no breath and no “uh” after it.",
  ㅂ: "Final ㅂ: close your lips and stop, no breath and no “uh” after it.",
  ㄹ: "Final ㄹ: tongue tip pressed behind the upper teeth and kept there, a light “l”, not “r”.",
};

const LENIS: Record<string, string> = {
  ㄱ: "ㄱ is soft, with a light breath and no tension.",
  ㄷ: "ㄷ is soft, with a light breath and no tension.",
  ㅂ: "ㅂ is soft, with a light breath and no tension.",
  ㅈ: "ㅈ is soft, with a light breath, closer to “j” than to “ch”.",
  ㅅ: "ㅅ is soft and a little breathy; before ㅣ it sounds almost like “sh”.",
};

function fill(text: string, expected: string, heard: string, like: string | undefined): string {
  return text.replaceAll("{e}", expected).replaceAll("{h}", heard).replaceAll("{like}", like ?? "");
}

/** The English sound to compare a non-lenis consonant with. */
function likeOf(s: { phonation: Phonation; place: string }): string | undefined {
  return s.phonation === "lenis" ? undefined : ENGLISH[s.place]?.[s.phonation];
}

function consonantFix(e: string, h: string | undefined): string | undefined {
  const a = SERIES[e];
  const b = h ? SERIES[h] : undefined;
  if (a && b && a.place === b.place && a.phonation !== b.phonation) {
    const text = PHONATION_FIX[a.phonation][b.phonation];
    if (text) return fill(text, e, h!, likeOf(a));
  }
  if (a?.phonation === "aspirated") return fill(PHONATION_FIX.aspirated.lenis!, e, "", likeOf(a));
  if (a?.phonation === "tense") return fill(PHONATION_FIX.tense.lenis!, e, "", likeOf(a));
  return LENIS[e] ?? CONSONANTS[e];
}

/** One line on how to say the sound right, or undefined when there is nothing useful to say. */
export function fixHint(error: ScoreError): string | undefined {
  const known = (j?: string) => (j && j !== "?" ? j : undefined);
  const e = known(error.expected?.jamo);
  const h = known(error.heard?.jamo);

  if (error.kind === "insertion") {
    if (h === "ㅡ") return "Don't add a vowel after the consonant: end the syllable on it, with no “uh” after.";
    return h ? `Extra ${h}: speak evenly, with nothing added between syllables.` : undefined;
  }
  if (!e) return undefined;

  if (error.position === "coda") {
    if (error.kind === "deletion") {
      if (e === "ㄱ" || e === "ㄷ" || e === "ㅂ")
        return `Don't swallow the end of the syllable: close your mouth for ${e} and hold it, but don't release it or breathe out.`;
      return `Don't swallow the end of the syllable: finish ${e} before starting the next one.`;
    }
    const fix = PAIRS[`coda:${e}>${h}`] ?? CODA[e];
    if (fix) return fix;
  }

  if (error.kind === "deletion") {
    if (e === "ㅎ") return "ㅎ is heard here: a light breath from the throat before the vowel.";
    if (error.position === "vowel") return `Don't swallow the vowel. ${VOWELS[e] ?? ""}`.trim();
  }

  if (error.position === "vowel") {
    return (h && PAIRS[`${e}>${h}`]) || VOWELS[e];
  }
  return consonantFix(e, h);
}
