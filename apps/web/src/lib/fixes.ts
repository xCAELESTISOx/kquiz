import type { ScoreResult } from "./types";

// "How to fix it" lines for the speech screen: one short articulation tip per wrong sound,
// written for a Russian speaker. Keyed by the jamo the scorer sends (services/scorer/app/phones.py).

type ScoreError = ScoreResult["errors"][number];

type Phonation = "lenis" | "aspirated" | "tense";

// Stops, affricates and ㅅ/ㅆ: the three-way contrast Russian does not have.
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
    aspirated: "Мягче и почти без выдоха: {e} расслабленный, лёгкая струйка воздуха, а не толчок, как у {h}.",
    tense: "Не зажимай горло: {e} мягкий и расслабленный, с лёгким выдохом, а {h} твёрдый и без воздуха.",
  },
  aspirated: {
    lenis: "Сильнее выдох: {e} как «к» с толчком воздуха после, будто задуваешь свечу. Ладонь у рта должна почувствовать поток.",
    tense: "Не зажимай, а выдохни: после {e} сильная струя воздуха, у {h} её нет совсем.",
  },
  tense: {
    lenis: "Напряги горло и скажи без выдоха, резко и чуть выше тоном: {e} похож на русское «к», только твёрже.",
    aspirated: "Без выдоха: {e} твёрдый и сжатый, воздух после него не идёт. Ладонь у рта ничего не должна почувствовать.",
  },
};

// Same-place lenis/aspirated/tense letters in the tips read wrong for ㅅ and the other places,
// so the "к" examples are swapped for the right Russian letter.
const RUSSIAN: Record<string, string> = { k: "к", t: "т", p: "п", c: "ч", s: "с" };

// Specific pairs, "expected>heard". Position-free unless the key starts with a position.
const PAIRS: Record<string, string> = {
  // Vowels Russian merges or does not have.
  "ㅓ>ㅗ": "Губы не округляй: ㅓ открытый, рот как для «а», а звук ближе к «о».",
  "ㅗ>ㅓ": "Округли губы и вытяни их вперёд: ㅗ узкое, почти как «у».",
  "ㅗ>ㅜ": "Чуть шире рот: ㅗ между «о» и «у», губы округлены, но не трубочкой.",
  "ㅜ>ㅗ": "Губы трубочкой и вперёд, как в русском «у».",
  "ㅜ>ㅡ": "Округли губы трубочкой: ㅜ — это «у», а не растянутое ㅡ.",
  "ㅡ>ㅜ": "Губы не округляй, растяни их, как в улыбке: язык как для «ы», только чуть дальше назад.",
  "ㅡ>ㅣ": "Язык назад, как для «ы»: ㅡ не «и», губы при этом растянуты.",
  "ㅡ>ㅓ": "Рот почти закрыт, губы растянуты: ㅡ узкое «ы», не открытое ㅓ.",
  "ㅓ>ㅡ": "Открой рот шире: ㅓ ближе к «о» с нижней челюстью вниз.",
  "ㅓ>ㅏ": "Чуть меньше открой рот и отведи язык назад: ㅓ темнее, чем «а».",
  "ㅏ>ㅓ": "Открой рот шире: ㅏ — ясное русское «а».",
  "ㅔ>ㅣ": "Опусти челюсть: ㅔ — русское «э», а не «и».",
  "ㅣ>ㅔ": "Уже рот и растяни губы: ㅣ — чистое «и».",
  "ㅕ>ㅛ": "Губы не округляй: ㅕ = «й» + открытое ㅓ, а не «ё».",
  "ㅛ>ㅕ": "Округли губы: ㅛ = «й» + узкое ㅗ, почти «ё».",
  "ㅝ>ㅗ": "Начни с «у» и раскрой рот в ㅓ: ㅝ = у + ㅓ, губы в конце не округлены.",
  "ㅢ>ㅣ": "Начни с ㅡ, губы растянуты, и быстро скользни в ㅣ.",
  "ㅢ>ㅡ": "Не останавливайся на ㅡ: в конце быстро скользни в «и».",
  // Codas: Korean finals are held, never released.
  "coda:ㅇ>ㄴ": "ㅇ в конце: кончик языка внизу, задняя часть спинки прижата к нёбу, звук идёт в нос, как в английском sing.",
  "coda:ㄴ>ㅇ": "ㄴ в конце: кончик языка к верхним зубам, как русское «н». Не уводи звук назад в «нг».",
  "coda:ㅁ>ㄴ": "Сомкни губы в конце слога: ㅁ закрывает слог губами.",
  "coda:ㅁ>ㅇ": "Сомкни губы в конце слога: ㅁ закрывает слог губами.",
  "coda:ㄴ>ㅁ": "Губы не смыкай: ㄴ — кончик языка к зубам.",
  "coda:ㅇ>ㄱ": "Здесь звук носовой: перед ㄴ и ㅁ ㄱ читается как ㅇ. Не обрывай его, пусти воздух в нос.",
  "coda:ㄴ>ㄷ": "Здесь звук носовой: перед ㄴ и ㅁ ㄷ читается как ㄴ. Не обрывай его, пусти воздух в нос.",
  "coda:ㅁ>ㅂ": "Здесь звук носовой: перед ㄴ и ㅁ ㅂ читается как ㅁ. Не обрывай его, пусти воздух в нос.",
  "coda:ㄹ>ㄴ": "ㄹ в конце: кончик языка прижат за верхними зубами и остаётся там, звук как мягкое «л».",
};

// Fallbacks by the expected sound, when no pair above fits.
const VOWELS: Record<string, string> = {
  ㅏ: "ㅏ — ясное русское «а», рот широко открыт.",
  ㅓ: "ㅓ — рот открыт, губы не округлены, звук между «о» и «а».",
  ㅗ: "ㅗ — губы округлены и вытянуты, узкое «о», почти «у».",
  ㅜ: "ㅜ — губы трубочкой, как русское «у».",
  ㅡ: "ㅡ — губы растянуты, как в улыбке, язык как для «ы».",
  ㅣ: "ㅣ — чистое «и», губы растянуты.",
  ㅔ: "ㅔ — русское «э», ㅐ и ㅔ сейчас звучат одинаково.",
  ㅑ: "ㅑ = короткое «й» + «а».",
  ㅕ: "ㅕ = короткое «й» + ㅓ, губы не округлены.",
  ㅛ: "ㅛ = короткое «й» + узкое ㅗ.",
  ㅠ: "ㅠ = короткое «й» + «у», как русское «ю».",
  ㅖ: "ㅖ = короткое «й» + «э».",
  ㅘ: "ㅘ = короткое «у» + «а», одним слогом.",
  ㅚ: "ㅚ = короткое «у» + «э», одним слогом.",
  ㅝ: "ㅝ = короткое «у» + ㅓ, одним слогом.",
  ㅟ: "ㅟ = короткое «у» + «и», одним слогом.",
  ㅢ: "ㅢ: начни с ㅡ и быстро скользни в «и».",
};

const CONSONANTS: Record<string, string> = {
  ㅎ: "ㅎ — лёгкий выдох из горла, мягче русского «х».",
  ㅁ: "ㅁ — сомкни губы, как для «м».",
  ㄴ: "ㄴ — кончик языка к верхним зубам, как «н».",
  ㅇ: "ㅇ в конце — задняя часть языка к нёбу, звук в нос, как в английском sing.",
  ㄹ: "ㄹ между гласными — один лёгкий удар языком, короткое «р» без раската.",
};

// Finals ㄱ ㄷ ㅂ are held and never released.
const CODA: Record<string, string> = {
  ㄱ: "ㄱ в конце: прижми заднюю часть языка к нёбу и остановись, без выдоха и без «ы» после.",
  ㄷ: "ㄷ в конце: прижми кончик языка к зубам и остановись, без выдоха и без «ы» после.",
  ㅂ: "ㅂ в конце: сомкни губы и остановись, без выдоха и без «ы» после.",
  ㄹ: "ㄹ в конце: кончик языка прижат за верхними зубами и остаётся там, звук как мягкое «л», не «р».",
};

const LENIS: Record<string, string> = {
  ㄱ: "ㄱ мягкий, с лёгким выдохом, без напряжения.",
  ㄷ: "ㄷ мягкий, с лёгким выдохом, без напряжения.",
  ㅂ: "ㅂ мягкий, с лёгким выдохом, без напряжения.",
  ㅈ: "ㅈ мягкий, с лёгким выдохом, ближе к «дж», чем к «ч».",
  ㅅ: "ㅅ мягкий, с лёгким придыханием; перед ㅣ звучит почти как «щ».",
};

function fill(text: string, expected: string, heard: string, place: string): string {
  return text.replaceAll("{e}", expected).replaceAll("{h}", heard).replaceAll("«к»", `«${RUSSIAN[place] ?? "к"}»`);
}

function consonantFix(e: string, h: string | undefined): string | undefined {
  const a = SERIES[e];
  const b = h ? SERIES[h] : undefined;
  if (a && b && a.place === b.place && a.phonation !== b.phonation) {
    const text = PHONATION_FIX[a.phonation][b.phonation];
    if (text) return fill(text, e, h!, a.place);
  }
  if (a?.phonation === "aspirated") return fill(PHONATION_FIX.aspirated.lenis!, e, "", a.place);
  if (a?.phonation === "tense") return fill(PHONATION_FIX.tense.lenis!, e, "", a.place);
  return LENIS[e] ?? CONSONANTS[e];
}

/** One line on how to say the sound right, or undefined when there is nothing useful to say. */
export function fixHint(error: ScoreError): string | undefined {
  const known = (j?: string) => (j && j !== "?" ? j : undefined);
  const e = known(error.expected?.jamo);
  const h = known(error.heard?.jamo);

  if (error.kind === "insertion") {
    if (h === "ㅡ") return "Не добавляй гласную после согласного: заканчивай слог на согласном, без «ы» в конце.";
    return h ? `Лишний ${h}: говори ровнее, без вставок между слогами.` : undefined;
  }
  if (!e) return undefined;

  if (error.position === "coda") {
    if (error.kind === "deletion") {
      if (e === "ㄱ" || e === "ㄷ" || e === "ㅂ")
        return `Не глотай конец слога: сомкни рот для ${e} и задержи, но не раскрывай звук и не выдыхай.`;
      return `Не глотай конец слога: доведи ${e} до конца, прежде чем начать следующий.`;
    }
    const fix = PAIRS[`coda:${e}>${h}`] ?? CODA[e];
    if (fix) return fix;
  }

  if (error.kind === "deletion") {
    if (e === "ㅎ") return "ㅎ здесь слышен: лёгкий выдох из горла перед гласной.";
    if (error.position === "vowel") return `Не проглатывай гласную. ${VOWELS[e] ?? ""}`.trim();
  }

  if (error.position === "vowel") {
    return (h && PAIRS[`${e}>${h}`]) || VOWELS[e];
  }
  return consonantFix(e, h);
}
