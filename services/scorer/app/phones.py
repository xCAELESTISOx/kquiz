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
    kind: str  # "C" consonant, "V" vowel, "G" glide
    jamo: str  # shown to the user
    place: str = ""
    manner: str = ""
    phonation: str = ""  # lenis / aspirated / tense / "" for sonorants


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
    Phone("j", "G", "y"),
    Phone("w", "G", "w"),
    Phone("ɰ", "G", "ㅢ"),
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
    "ㅏ": ["a"],
    "ㅐ": ["e"],
    "ㅑ": ["j", "a"],
    "ㅒ": ["j", "e"],
    "ㅓ": ["ʌ"],
    "ㅔ": ["e"],
    "ㅕ": ["j", "ʌ"],
    "ㅖ": ["j", "e"],
    "ㅗ": ["o"],
    "ㅘ": ["w", "a"],
    "ㅙ": ["w", "e"],
    "ㅚ": ["w", "e"],
    "ㅛ": ["j", "o"],
    "ㅜ": ["u"],
    "ㅝ": ["w", "ʌ"],
    "ㅞ": ["w", "e"],
    "ㅟ": ["w", "i"],
    "ㅠ": ["j", "u"],
    "ㅡ": ["ɯ"],
    "ㅢ": ["ɰ", "i"],
    "ㅣ": ["i"],
}

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
    "j": "j",
    "w": "w",
    "ɰ": "ɰ",
    "ɥ": "w",
    "ʋ": "w",
}

_TENSE_OF = {"k": "k͈", "t": "t͈", "p": "p͈", "tɕ": "t͈ɕ", "s": "s͈"}
_ASPIRATED_OF = {"k": "kʰ", "t": "tʰ", "p": "pʰ", "tɕ": "tɕʰ"}

SPECIAL_TOKENS = {"<pad>", "<s>", "</s>", "<unk>", "|", "[PAD]", "[UNK]", "", " ", "sil", "sp", "spn"}


def normalize_token(token: str) -> str | None:
    """Map one acoustic-model label to a canonical phone.

    Returns BLANK for CTC blank / word separators, OTHER for labels we do not
    recognise, otherwise a key of PHONES.
    """
    if token in SPECIAL_TOKENS or token.startswith("<") or token.startswith("["):
        return BLANK
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
_GLIDE_VOWEL = {
    frozenset({"j", "i"}): 0.4,
    frozenset({"w", "u"}): 0.4,
    frozenset({"w", "o"}): 0.5,
    frozenset({"ɰ", "ɯ"}): 0.4,
}


def substitution_cost(expected: str, heard: str) -> float:
    """0 for the same sound, around 0.4-0.5 for near misses, up to 1 for far ones."""
    if expected == heard:
        return 0.0
    if heard == OTHER or expected == OTHER:
        return 0.9
    a, b = PHONES[expected], PHONES[heard]
    pair = frozenset({expected, heard})
    if a.kind == b.kind == "V":
        return _NEAR_VOWELS.get(pair, 0.8)
    if a.kind == b.kind == "G":
        return 0.5
    if {a.kind, b.kind} == {"V", "G"}:
        return _GLIDE_VOWEL.get(pair, 0.8)
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
    kind = PHONES[phone].kind
    if kind == "G":
        return 0.4  # 계 [ke], 의 [이] in casual speech
    if phone == "h":
        return 0.5  # intervocalic ㅎ is often weak in native speech
    return 1.0


def insertion_cost(phone: str) -> float:
    if phone != OTHER and PHONES[phone].kind == "G":
        return 0.3
    return 0.5


def label(phone: str) -> dict[str, str]:
    if phone == OTHER:
        return {"ipa": "?", "jamo": "?"}
    return {"ipa": phone, "jamo": PHONES[phone].jamo}
