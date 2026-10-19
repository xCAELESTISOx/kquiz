"""The scoring pipeline: audio + text -> score, per-syllable status, errors."""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field

import numpy as np

from . import audio as audio_mod
from .align import ctc_forced_align, ctc_greedy, goodness, weighted_levenshtein
from .g2p import Reference, reference
from .phones import label
from .recognizer import BLANK_ID, CLASS_INDEX, CLASSES, Recognizer, project, projection

# Thresholds to calibrate in stage 0 with the eval harness (app/eval.py).
WEAK_SUBSTITUTION = 0.5  # substitutions at or below this cost are "weak", above are "wrong"
LOW_CONFIDENCE = 0.35  # a matched sound with GOP confidence below this is "weak"
LOW_CONFIDENCE_CREDIT = 0.7
# A syllable's credit is the mean of its sounds, capped by its worst status, so
# one wrong sound in a short word cannot still earn a "good".
SYLLABLE_CAP = {"ok": 1.0, "weak": 0.8, "wrong": 0.4}

_RANK = {"ok": 0, "weak": 1, "wrong": 2}


@dataclass
class Syllable:
    text: str
    pron: str
    status: str = "ok"


@dataclass
class Error:
    syllable: int
    position: str  # onset / vowel / coda / extra
    kind: str  # substitution / deletion / insertion / unclear
    status: str  # weak / wrong
    expected: dict[str, str] | None
    heard: dict[str, str] | None


@dataclass
class Result:
    score: int
    text: str
    pronunciation: str
    syllables: list[Syllable]
    errors: list[Error]
    target_phones: list[str]
    heard_phones: list[str]
    confidence: list[float | None] = field(default_factory=list)
    timing_ms: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


class Scorer:
    def __init__(self, recognizer: Recognizer):
        self.recognizer = recognizer
        self.groups, self.mapping = projection(recognizer.vocab)

    def score_wav(self, data: bytes, text: str) -> Result:
        ref = reference(text)  # validate text before spending CPU on audio
        t0 = time.perf_counter()
        x = audio_mod.prepare(data)
        t1 = time.perf_counter()
        logp = project(self.recognizer.log_probs(x), self.groups)
        t2 = time.perf_counter()
        result = score_logp(logp, ref)
        t3 = time.perf_counter()
        result.timing_ms = {
            "audio": round((t1 - t0) * 1000),
            "model": round((t2 - t1) * 1000),
            "align": round((t3 - t2) * 1000),
            "speech": round(len(x) / audio_mod.SAMPLE_RATE * 1000),
        }
        return result


def score_logp(logp: np.ndarray, ref: Reference) -> Result:
    """Score canonical-class log-probs (frames, len(CLASSES)) against a reference."""
    expected = [p.phone for p in ref.phones]
    heard_ids = ctc_greedy(logp, BLANK_ID)
    heard = [CLASSES[i] for i in heard_ids]

    target_ids = [CLASS_INDEX[p] for p in expected]
    spans = ctc_forced_align(logp, target_ids, BLANK_ID)
    conf: list[float | None] = goodness(logp, spans, target_ids) if spans else [None] * len(expected)

    syllables = [Syllable(t, p) for t, p in zip(ref.syllables, ref.pron_syllables, strict=True)]
    errors: list[Error] = []
    credit = [[] for _ in syllables]  # per-sound credit in each syllable
    penalty = [0.0 for _ in syllables]

    def mark(idx: int, status: str) -> None:
        if _RANK[status] > _RANK[syllables[idx].status]:
            syllables[idx].status = status

    ops = weighted_levenshtein(expected, heard)
    for k, op in enumerate(ops):
        if op.kind == "ins":
            # attach an extra sound to the syllable of the next expected sound
            nxt = next((o.target for o in ops[k:] if o.target is not None), None)
            prv = next((o.target for o in reversed(ops[:k]) if o.target is not None), None)
            tgt = nxt if nxt is not None else prv
            if tgt is None:
                continue
            syl = ref.phones[tgt].syllable
            penalty[syl] += op.cost
            errors.append(Error(syl, "extra", "insertion", "weak", None, label(heard[op.heard])))
            mark(syl, "weak")
            continue
        tp = ref.phones[op.target]
        if op.kind == "match":
            c = conf[op.target]
            if c is not None and c < LOW_CONFIDENCE:
                credit[tp.syllable].append(LOW_CONFIDENCE_CREDIT)
                errors.append(
                    Error(tp.syllable, tp.position, "unclear", "weak", label(tp.phone), label(tp.phone))
                )
                mark(tp.syllable, "weak")
            else:
                credit[tp.syllable].append(1.0)
            continue
        status = "weak" if op.cost <= WEAK_SUBSTITUTION else "wrong"
        credit[tp.syllable].append(max(0.0, 1.0 - op.cost))
        if op.kind == "sub":
            heard_label = label(heard[op.heard])
            kind = "substitution"
        else:
            heard_label = None
            kind = "deletion"
        errors.append(Error(tp.syllable, tp.position, kind, status, label(tp.phone), heard_label))
        mark(tp.syllable, status)

    per_syllable = [
        min(SYLLABLE_CAP[syl.status], max(0.0, sum(c) / max(len(c), 1) - pen / max(len(c), 1)))
        for syl, c, pen in zip(syllables, credit, penalty, strict=True)
    ]
    score = round(100 * sum(per_syllable) / max(len(per_syllable), 1))
    return Result(
        score=score,
        text=ref.text,
        pronunciation=ref.pronunciation,
        syllables=syllables,
        errors=errors,
        target_phones=expected,
        heard_phones=heard,
        confidence=[None if c is None else round(c, 3) for c in conf],
    )
