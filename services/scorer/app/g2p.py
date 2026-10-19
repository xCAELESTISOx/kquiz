"""Reference pronunciation: text -> pronounced Hangul -> canonical phones.

g2pkiwi applies the standard pronunciation rules (linking, nasalisation,
tensing, ...). It downloads NLTK's cmudict on first import, so install it once
with `python -m nltk.downloader cmudict` on machines without internet access.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from unittest.mock import patch

from .phones import CODA_PHONES, TargetPhone, decompose, is_syllable, syllable_phones

MAX_SYLLABLES = 40
_ALLOWED = re.compile(r"^[가-힣\s.,!?~…·'\"\-]+$")


class InvalidText(ValueError):
    pass


def clean_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text).strip()
    if not text or not _ALLOWED.match(text):
        raise InvalidText("text must be Hangul syllables, spaces and punctuation")
    n = sum(is_syllable(c) for c in text)
    if n == 0:
        raise InvalidText("text has no Hangul syllables")
    if n > MAX_SYLLABLES:
        raise InvalidText(f"text is longer than {MAX_SYLLABLES} syllables")
    return text


@lru_cache(maxsize=1)
def _g2p():
    import nltk

    try:
        nltk.data.find("corpora/cmudict")
    except LookupError:
        from g2pkiwi import G2p
    else:
        # g2pkiwi calls nltk.download("cmudict") on import even when it is installed, which needs
        # the network and a writable home; the deploy container has neither.
        with patch.object(nltk, "download", return_value=True):
            from g2pkiwi import G2p

    return G2p()


@dataclass(frozen=True)
class Reference:
    text: str
    pronunciation: str  # pronounced form in Hangul, e.g. 궁물 for 국물
    syllables: list[str]  # the written syllables the user sees
    pron_syllables: list[str]
    phones: list[TargetPhone]
    romanization: str


@lru_cache(maxsize=2048)
def reference(text: str) -> Reference:
    text = clean_text(text)
    pron = unicodedata.normalize("NFC", _g2p()(text))
    written = [c for c in text if is_syllable(c)]
    spoken = [c for c in pron if is_syllable(c)]
    # The rules keep the syllable count; if g2p ever breaks that, show what is said.
    shown = written if len(written) == len(spoken) else spoken
    phones = [p for i, syl in enumerate(spoken) for p in syllable_phones(syl, i)]
    return Reference(
        text=text,
        pronunciation=pron,
        syllables=shown,
        pron_syllables=spoken,
        phones=phones,
        romanization=romanize(pron, text),
    )


# --- Revised Romanization -------------------------------------------------------

_RR_ONSET = {
    "ㄱ": "g",
    "ㄲ": "kk",
    "ㄴ": "n",
    "ㄷ": "d",
    "ㄸ": "tt",
    "ㄹ": "r",
    "ㅁ": "m",
    "ㅂ": "b",
    "ㅃ": "pp",
    "ㅅ": "s",
    "ㅆ": "ss",
    "ㅇ": "",
    "ㅈ": "j",
    "ㅉ": "jj",
    "ㅊ": "ch",
    "ㅋ": "k",
    "ㅌ": "t",
    "ㅍ": "p",
    "ㅎ": "h",
}
_RR_VOWEL = {
    "ㅏ": "a",
    "ㅐ": "ae",
    "ㅑ": "ya",
    "ㅒ": "yae",
    "ㅓ": "eo",
    "ㅔ": "e",
    "ㅕ": "yeo",
    "ㅖ": "ye",
    "ㅗ": "o",
    "ㅘ": "wa",
    "ㅙ": "wae",
    "ㅚ": "oe",
    "ㅛ": "yo",
    "ㅜ": "u",
    "ㅝ": "wo",
    "ㅞ": "we",
    "ㅟ": "wi",
    "ㅠ": "yu",
    "ㅡ": "eu",
    "ㅢ": "ui",
    "ㅣ": "i",
}
_RR_CODA = {"k": "k", "n": "n", "t": "t", "l": "l", "m": "m", "p": "p", "ŋ": "ng"}
_UNTENSE = {"ㄲ": "ㄱ", "ㄸ": "ㄷ", "ㅃ": "ㅂ", "ㅆ": "ㅅ", "ㅉ": "ㅈ"}


def romanize(pron: str, written: str = "") -> str:
    """Revised Romanization of the pronounced form.

    RR follows pronunciation except that it does not mark tensing (학교 ->
    hakgyo), so tense onsets that are lenis in the written form are undone.
    """
    written_syls = [c for c in written if is_syllable(c)]
    pron_syls = [c for c in pron if is_syllable(c)]
    aligned = len(written_syls) == len(pron_syls)
    out: list[str] = []
    prev_coda = ""
    k = 0
    for ch in pron:
        if not is_syllable(ch):
            out.append(" " if ch.isspace() else "")
            prev_coda = ""
            continue
        onset, vowel, coda = decompose(ch)
        if aligned and onset in _UNTENSE and decompose(written_syls[k])[0] == _UNTENSE[onset]:
            onset = _UNTENSE[onset]
        ons = _RR_ONSET[onset]
        if onset == "ㄹ" and prev_coda == "l":
            ons = "l"
        out.append(ons + _RR_VOWEL[vowel])
        coda_phone = (CODA_PHONES[coda] or [""])[0]
        prev_coda = coda_phone
        out.append(_RR_CODA.get(coda_phone, ""))
        k += 1
    return re.sub(r"\s+", " ", "".join(out)).strip()
