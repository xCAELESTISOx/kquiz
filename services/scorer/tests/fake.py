"""A stand-in acoustic model that 'hears' a fixed sequence of labels."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from app.audio import to_wav
from app.phones import normalize_token

DATA = Path(__file__).parent / "fixtures"

# The real label set of the default model (Apache-2.0), so tests exercise its mapping.
_vocab = json.loads((DATA / "slplab_vocab.json").read_text(encoding="utf-8"))
VOCAB = [t for t, _ in sorted(_vocab.items(), key=lambda kv: kv[1])]
_TOKEN_FOR = {}
for _t in VOCAB:
    _TOKEN_FOR.setdefault(normalize_token(_t), _t)


class FakeRecognizer:
    vocab = VOCAB

    def __init__(self, labels: list[str], frames: int = 4, confidence: float = 0.9, raw: bool = False):
        # labels are canonical phones, or the model's own labels with raw=True
        self.labels = labels if raw else [_TOKEN_FOR[p] for p in labels]
        self.frames = frames
        self.confidence = confidence  # posterior of each heard sound; blanks stay at 0.9

    def log_probs(self, audio: np.ndarray) -> np.ndarray:
        rows = []
        v = len(VOCAB)

        BLANK_ID = VOCAB.index("[PAD]")

        def row(idx: int, p: float) -> np.ndarray:
            r = np.full(v, (1 - p) / (v - 1))
            r[idx] = p
            return r

        rows.append(row(BLANK_ID, 0.9))
        for lab in self.labels:
            rows += [row(VOCAB.index(lab), self.confidence)] * self.frames
            rows.append(row(BLANK_ID, 0.9))
        return np.log(np.array(rows))


def tone_wav(seconds: float = 1.0, rate: int = 16_000, lead: float = 0.5) -> bytes:
    t = np.arange(int(seconds * rate)) / rate
    x = 0.3 * np.sin(2 * np.pi * 220 * t)
    silence = np.zeros(int(lead * rate))
    return to_wav(np.concatenate([silence, x, silence]), rate)
