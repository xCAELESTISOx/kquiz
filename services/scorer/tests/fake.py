"""A stand-in acoustic model that 'hears' a fixed sequence of labels."""

from __future__ import annotations

import numpy as np

from app.audio import to_wav

# Labels in the style of the MFA Korean phone set, including allophones.
VOCAB = [
    "<pad>",
    "<s>",
    "</s>",
    "<unk>",
    "|",
    "k",
    "kʰ",
    "k͈",
    "t",
    "tʰ",
    "t͈",
    "p",
    "pʰ",
    "p͈",
    "tɕ",
    "tɕʰ",
    "t͈ɕ",
    "s",
    "s͈",
    "h",
    "m",
    "n",
    "ŋ",
    "l",
    "ɾ",
    "a",
    "ʌ",
    "o",
    "u",
    "ɯ",
    "i",
    "e",
    "ɛ",
    "j",
    "w",
    "ɰ",
    "k̚",
    "t̚",
    "p̚",
    "b",
    "d",
    "ɡ",
    "dʑ",
    "ɕ",
    "ø",
]


class FakeRecognizer:
    vocab = VOCAB

    def __init__(self, labels: list[str], frames: int = 4, confidence: float = 0.9):
        self.labels = labels
        self.frames = frames
        self.confidence = confidence  # posterior of each heard sound; blanks stay at 0.9

    def log_probs(self, audio: np.ndarray) -> np.ndarray:
        rows = []
        v = len(VOCAB)

        def row(idx: int, p: float) -> np.ndarray:
            r = np.full(v, (1 - p) / (v - 1))
            r[idx] = p
            return r

        rows.append(row(0, 0.9))
        for lab in self.labels:
            rows += [row(VOCAB.index(lab), self.confidence)] * self.frames
            rows.append(row(0, 0.9))
        return np.log(np.array(rows))


def tone_wav(seconds: float = 1.0, rate: int = 16_000, lead: float = 0.5) -> bytes:
    t = np.arange(int(seconds * rate)) / rate
    x = 0.3 * np.sin(2 * np.pi * 220 * t)
    silence = np.zeros(int(lead * rate))
    return to_wav(np.concatenate([silence, x, silence]), rate)
