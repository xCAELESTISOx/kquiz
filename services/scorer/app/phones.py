"""Canonical phone inventory shared by the reference (g2p) and the recogniser.

Both sides are reduced to the same small set of phonemes, so comparison does
not depend on the exact label set of the acoustic model. Allophones that a
learner cannot control (lenis voicing, unreleased codas, ㄹ as [ɾ] or [l]) and
the Seoul-norm mergers (ㅐ = ㅔ) collapse into one class and are never
penalised.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

BLANK = "<blank>"
OTHER = "?"  # a model token we could not map; shows up as an unknown sound


@dataclass(frozen=True)
class Phone:
    ipa: str
    kind: str  # "C" consonant, "V" vowel (diphthongs included)
    jamo: str  # shown to the user
    place: str = ""
    manner: str = ""
    phonation: str = ""  # lenis / aspirated / tense / "" for sonorants
    glide: str = ""  # diphthongs: j / w / ɰ
    base: str = ""  # diphthongs: the vowel after the glide


_INVENTORY = [
    Phone("k", "C", "ㄱ", "velar", "stop", "lenis"),
    Phone("kʰ", "C", "ㅋ", "velar", "stop", "aspirated"),
    Phone("k͈", "C", "ㄲ", "velar", "stop", "tense"),
    Phone("t", "C", "ㄷ", "alveolar", "stop", "lenis"),
    Phone("tʰ", "C", "ㅌ", "alveolar", "stop", "aspirated"),
    Phone("t͈", "C", "ㄸ", "alveolar", "stop", "tense"),
    Phone("p", "C", "ㅂ", "bilabial", "stop", "lenis"),
    Phone("pʰ", "C", "ㅍ", "bilabial", "stop", "aspirated"),
    Phone("p͈", "C", "ㅃ", "bilabial", "stop", "tense"),
    Phone("tɕ", "C", "ㅈ", "palatal", "affricate", "lenis"),
    Phone("tɕʰ", "C", "ㅊ", "palatal", "affricate", "aspirated"),
    Phone("t͈ɕ", "C", "ㅉ", "palatal", "affricate", "tense"),
    Phone("s", "C", "ㅅ", "alveolar", "fricative", "lenis"),
    Phone("s͈", "C", "ㅆ", "alveolar", "fricative", "tense"),
    Phone("h", "C", "ㅎ", "glottal", "fricative"),
    Phone("m", "C", "ㅁ", "bilabial", "nasal"),
    Phone("n", "C", "ㄴ", "alveolar", "nasal"),
    Phone("ŋ", "C", "ㅇ", "velar", "nasal"),
    Phone("l", "C", "ㄹ", "alveolar", "liquid"),
    Phone("a", "V", "ㅏ"),
    Phone("ʌ", "V", "ㅓ"),
    Phone("o", "V", "ㅗ"),
    Phone("u", "V", "ㅜ"),
    Phone("ɯ", "V", "ㅡ"),
    Phone("i", "V", "ㅣ"),
    Phone("e", "V", "ㅔ"),  # ㅐ and ㅔ are one vowel in Seoul speech
    # Diphthongs are single units, as in the acoustic model's label set.
    Phone("ja", "V", "ㅑ", glide="j", base="a"),
    Phone("je", "V", "ㅖ", glide="j", base="e"),  # ㅒ and ㅖ
    Phone("jʌ", "V", "ㅕ", glide="j", base="ʌ"),
    Phone("jo", "V", "ㅛ", glide="j", base="o"),
    Phone("ju", "V", "ㅠ", glide="j", base="u"),
    Phone("wa", "V", "ㅘ", glide="w", base="a"),
    Phone("we", "V", "ㅚ", glide="w", base="e"),  # ㅙ, ㅚ and ㅞ in Seoul speech
    Phone("wʌ", "V", "ㅝ", glide="w", base="ʌ"),
    Phone("wi", "V", "ㅟ", glide="w", base="i"),
    Phone("ɰi", "V", "ㅢ", glide="ɰ", base="i"),
]

PHONES: dict[str, Phone] = {p.ipa: p for p in _INVENTORY}
CANONICAL: list[str] = [p.ipa for p in _INVENTORY]

# --- Hangul -> canonical phones ------------------------------------------------

_ONSETS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_VOWELS = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
_CODAS = ["", *"ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"]

ONSET_PHONES = {
    "ㄱ": ["k"],
    "ㄲ": ["k͈"],
    "ㄴ": ["n"],
    "ㄷ": ["t"],
    "ㄸ": ["t͈"],
    "ㄹ": ["l"],
    "ㅁ": ["m"],
    "ㅂ": ["p"],
    "ㅃ": ["p͈"],
    "ㅅ": ["s"],
    "ㅆ": ["s͈"],
    "ㅇ": [],
    "ㅈ": ["tɕ"],
    "ㅉ": ["t͈ɕ"],
    "ㅊ": ["tɕʰ"],
    "ㅋ": ["kʰ"],
    "ㅌ": ["tʰ"],
    "ㅍ": ["pʰ"],
    "ㅎ": ["h"],
}

VOWEL_PHONES = {
    "ㅏ": ["a"], "ㅐ": ["e"], "ㅑ": ["ja"], "ㅒ": ["je"], "ㅓ": ["ʌ"], "ㅔ": ["e"],
    "ㅕ": ["jʌ"], "ㅖ": ["je"], "ㅗ": ["o"], "ㅘ": ["wa"], "ㅙ": ["we"], "ㅚ": ["we"],
    "ㅛ": ["jo"], "ㅜ": ["u"], "ㅝ": ["wʌ"], "ㅞ": ["we"], "ㅟ": ["wi"], "ㅠ": ["ju"],
    "ㅡ": ["ɯ"], "ㅢ": ["ɰi"], "ㅣ": ["i"],
}  # fmt: skip

# Codas are neutralised to seven sounds; complex codas keep the one that is
# pronounced before a pause (g2p already resolves them in context).
CODA_PHONES = {
    "": [],
    "ㄱ": ["k"],
    "ㄲ": ["k"],
    "ㄳ": ["k"],
    "ㄴ": ["n"],
    "ㄵ": ["n"],
    "ㄶ": ["n"],
    "ㄷ": ["t"],
    "ㄹ": ["l"],
    "ㄺ": ["k"],
    "ㄻ": ["m"],
    "ㄼ": ["l"],
    "ㄽ": ["l"],
    "ㄾ": ["l"],
    "ㄿ": ["p"],
    "ㅀ": ["l"],
    "ㅁ": ["m"],
    "ㅂ": ["p"],
    "ㅄ": ["p"],
    "ㅅ": ["t"],
    "ㅆ": ["t"],
    "ㅇ": ["ŋ"],
    "ㅈ": ["t"],
    "ㅊ": ["t"],
    "ㅋ": ["k"],
    "ㅌ": ["t"],
    "ㅍ": ["p"],
    "ㅎ": ["t"],
}


def is_syllable(ch: str) -> bool:
    return "가" <= ch <= "힣"


def decompose(syllable: str) -> tuple[str, str, str]:
    """가 -> ("ㄱ", "ㅏ", "")."""
    code = ord(syllable) - ord("가")
    if not 0 <= code < 11172:
        raise ValueError(f"not a Hangul syllable: {syllable!r}")
    return _ONSETS[code // 588], _VOWELS[(code % 588) // 28], _CODAS[code % 28]


@dataclass(frozen=True)
class TargetPhone:
    phone: str
    syllable: int  # index into the syllables of the word
    position: str  # onset / vowel / coda


def syllable_phones(syllable: str, index: int) -> list[TargetPhone]:
    onset, vowel, coda = decompose(syllable)
    out = [TargetPhone(p, index, "onset") for p in ONSET_PHONES[onset]]
    out += [TargetPhone(p, index, "vowel") for p in VOWEL_PHONES[vowel]]
    out += [TargetPhone(p, index, "coda") for p in CODA_PHONES[coda]]
    return out


# --- model token -> canonical phone ------------------------------------------

_STRIP = {"ː", "ˑ", "̚", "ʲ", "ʷ", "ˀ", "̥", "̬", "̹", "̜"}
_TENSE_MARKS = {"͈", "*", "'", "’"}

_BASE = {
    # velars (c/ɟ are palatalised ㄱ before i/j in some phone sets)
    "k": "k",
    "g": "k",
    "ɡ": "k",
    "ɣ": "k",
    "c": "k",
    "ɟ": "k",
    "q": "k",
    "t": "t",
    "d": "t",
    "p": "p",
    "b": "p",
    "β": "p",
    "tɕ": "tɕ",
    "dʑ": "tɕ",
    "tʃ": "tɕ",
    "dʒ": "tɕ",
    "ts": "tɕ",
    "ʥ": "tɕ",
    "ʨ": "tɕ",
    "s": "s",
    "ɕ": "s",
    "ʃ": "s",
    "z": "s",
    "h": "h",
    "ɦ": "h",
    "ç": "h",
    "x": "h",
    "ɸ": "h",
    "ʝ": "h",
    "m": "m",
    "n": "n",
    "ɲ": "n",
    "ŋ": "ŋ",
    "l": "l",
    "ɾ": "l",
    "ɭ": "l",
    "ʎ": "l",
    "r": "l",
    "ɹ": "l",
    "a": "a",
    "ɐ": "a",
    "ɑ": "a",
    "ʌ": "ʌ",
    "ɔ": "ʌ",
    "ə": "ʌ",
    "o": "o",
    "u": "u",
    "ʊ": "u",
    "ɯ": "ɯ",
    "ɨ": "ɯ",
    "ɪ": "i",
    "i": "i",
    "e": "e",
    "ɛ": "e",
    "æ": "e",
    "ø": "e",
    "y": "i",
}

_TENSE_OF = {"k": "k͈", "t": "t͈", "p": "p͈", "tɕ": "t͈ɕ", "s": "s͈"}
_ASPIRATED_OF = {"k": "kʰ", "t": "tʰ", "p": "pʰ", "tɕ": "tɕʰ"}

# Labels of slplab/wav2vec2-xls-r-300m_phone-mfa_korean: romanised jamo, upper
# case for onsets and vowels, lower-case k/p/t for unreleased codas.
SLPLAB_LABELS = {
    "G": "k", "GG": "k͈", "Kh": "kʰ", "k": "k", "D": "t", "DD": "t͈", "Th": "tʰ", "t": "t",
    "B": "p", "BB": "p͈", "Ph": "pʰ", "p": "p", "J": "tɕ", "JJ": "t͈ɕ", "CHh": "tɕʰ",
    "S": "s", "SS": "s͈", "H": "h", "M": "m", "N": "n", "NG": "ŋ", "L": "l", "R": "l",
    "A": "a", "EO": "ʌ", "O": "o", "U": "u", "EU": "ɯ", "I": "i", "E": "e",
    "iA": "ja", "iE": "je", "iEO": "jʌ", "iO": "jo", "iU": "ju",
    "oA": "wa", "oE": "we", "uEO": "wʌ", "uI": "wi", "euI": "ɰi",
}  # fmt: skip

SPECIAL_TOKENS = {"<pad>", "<s>", "</s>", "<unk>", "|", "[PAD]", "[UNK]", "", " ", "sil", "sp", "spn"}


def normalize_token(token: str) -> str | None:
    """Map one acoustic-model label to a canonical phone.

    Returns BLANK for CTC blank / word separators, OTHER for labels we do not
    recognise, otherwise a key of PHONES.
    """
    if token in SPECIAL_TOKENS or token.startswith("<") or token.startswith("["):
        return BLANK
    if token in SLPLAB_LABELS:
        return SLPLAB_LABELS[token]
    s = unicodedata.normalize("NFD", token)
    tense = any(m in s for m in _TENSE_MARKS)
    aspirated = "ʰ" in s or (s[-1:] == "h" and s[:-1] in _ASPIRATED_OF)
    for ch in (*_TENSE_MARKS, *_STRIP, "ʰ"):
        s = s.replace(ch, "")
    if aspirated and s.endswith("h") and s[:-1] in _ASPIRATED_OF:
        s = s[:-1]
    if len(s) == 2 and s[0] == s[1] and s in {"kk", "tt", "pp", "ss"}:  # kk-style tense
        s, tense = s[0], True
    if s in {"jj", "cc"}:
        s, tense = "tɕ", True
    base = _BASE.get(s)
    if base is None:
        return OTHER
    if tense and base in _TENSE_OF:
        return _TENSE_OF[base]
    if aspirated and base in _ASPIRATED_OF:
        return _ASPIRATED_OF[base]
    return base


# --- substitution costs --------------------------------------------------------

_NEAR_VOWELS = {
    frozenset({"ʌ", "o"}): 0.4,
    frozenset({"o", "u"}): 0.4,
    frozenset({"u", "ɯ"}): 0.4,
    frozenset({"ʌ", "a"}): 0.5,
    frozenset({"ʌ", "ɯ"}): 0.5,
    frozenset({"e", "i"}): 0.6,
    frozenset({"ɯ", "i"}): 0.6,
    frozenset({"a", "e"}): 0.6,
}
# Dropping or adding the glide of a diphthong (계 [ke], 의사 [이사]) is a near miss.
_GLIDE_LOSS = {"je": 0.3, "ɰi": 0.3}


def _vowel_cost(a: Phone, b: Phone) -> float:
    if a.glide and b.glide:
        if a.glide == b.glide:
            return _vowel_cost(PHONES[a.base], PHONES[b.base])
        return 0.5 if a.base == b.base else 0.8
    if a.glide or b.glide:
        di, mono = (a, b) if a.glide else (b, a)
        if di.base == mono.ipa:
            return _GLIDE_LOSS.get(di.ipa, 0.4)
        return 0.8
    return _NEAR_VOWELS.get(frozenset({a.ipa, b.ipa}), 0.8)


def substitution_cost(expected: str, heard: str) -> float:
    """0 for the same sound, around 0.3-0.5 for near misses, up to 1 for far ones."""
    if expected == heard:
        return 0.0
    if heard == OTHER or expected == OTHER:
        return 0.9
    a, b = PHONES[expected], PHONES[heard]
    if a.kind == b.kind == "V":
        return _vowel_cost(a, b)
    if a.kind == b.kind == "C":
        if a.place == b.place and a.manner == b.manner:
            return 0.4  # ㄱ/ㅋ/ㄲ, ㅅ/ㅆ: phonation only
        if a.manner == b.manner == "nasal":
            return 0.6
        if a.place == b.place or {a.place, b.place} == {"alveolar", "palatal"}:
            return 0.7  # ㄷ/ㄴ, ㅅ/ㄷ, ㅈ/ㄷ: what assimilation errors look like
        return 0.9
    return 1.0


def deletion_cost(phone: str) -> float:
    if phone == "h":
        return 0.5  # intervocalic ㅎ is often weak in native speech
    return 1.0


def insertion_cost(phone: str) -> float:
    return 0.5


def label(phone: str) -> dict[str, str]:
    if phone == OTHER:
        return {"ipa": "?", "jamo": "?"}
    return {"ipa": phone, "jamo": PHONES[phone].jamo}
