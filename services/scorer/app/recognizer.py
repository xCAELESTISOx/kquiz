"""Phone recognition with a CTC acoustic model (PLAN.md §4.3 step 2).

The model's own label set is projected onto the canonical phones of
`phones.py`, summing probabilities of labels that map to the same class, so
the rest of the pipeline never sees model-specific labels.
"""

from __future__ import annotations

import logging
import os
from typing import Protocol

import numpy as np

from .phones import BLANK, CANONICAL, OTHER, normalize_token

log = logging.getLogger(__name__)

DEFAULT_MODEL = "slplab/wav2vec2-xls-r-300m_phone-mfa_korean"

# Canonical class order used by every downstream array: blank, phones, unknown.
CLASSES: list[str] = [BLANK, *CANONICAL, OTHER]
CLASS_INDEX = {c: i for i, c in enumerate(CLASSES)}
BLANK_ID = 0


class Recognizer(Protocol):
    vocab: list[str]

    def log_probs(self, audio: np.ndarray) -> np.ndarray:
        """16 kHz mono float audio -> (frames, len(vocab)) log-probabilities."""
        ...


def projection(vocab: list[str]) -> tuple[list[list[int]], dict[str, str]]:
    """For each canonical class, the model label ids that belong to it."""
    groups: list[list[int]] = [[] for _ in CLASSES]
    mapping: dict[str, str] = {}
    for idx, token in enumerate(vocab):
        cls = normalize_token(token)
        mapping[token] = cls
        groups[CLASS_INDEX[cls]].append(idx)
    return groups, mapping


def project(logp: np.ndarray, groups: list[list[int]]) -> np.ndarray:
    """(frames, model vocab) -> (frames, CLASSES) by log-sum-exp within each class."""
    out = np.full((logp.shape[0], len(groups)), -np.inf, dtype=np.float64)
    for c, ids in enumerate(groups):
        if ids:
            sub = logp[:, ids].astype(np.float64)
            peak = sub.max(axis=1, keepdims=True)
            out[:, c] = (peak + np.log(np.exp(sub - peak).sum(axis=1, keepdims=True)))[:, 0]
    return out


def missing_phones(groups: list[list[int]]) -> list[str]:
    return [c for c, ids in zip(CLASSES, groups, strict=True) if not ids and c not in (OTHER,)]


class Wav2Vec2Recognizer:
    """Hugging Face wav2vec2 CTC model, run on CPU."""

    def __init__(self, model: str | None = None, threads: int | None = None):
        import torch
        from transformers import AutoFeatureExtractor, AutoTokenizer, Wav2Vec2ForCTC

        name = model or os.environ.get("SCORER_MODEL", DEFAULT_MODEL)
        torch.set_num_threads(threads or int(os.environ.get("SCORER_THREADS", "2")))
        self._torch = torch
        self.name = name
        self.features = AutoFeatureExtractor.from_pretrained(name)
        tokenizer = AutoTokenizer.from_pretrained(name)
        vocab = tokenizer.get_vocab()
        self.vocab = [t for t, _ in sorted(vocab.items(), key=lambda kv: kv[1])]
        self.model = Wav2Vec2ForCTC.from_pretrained(name).eval()
        pad = tokenizer.pad_token
        if pad is not None and pad in vocab:
            # The CTC blank is the pad token; make sure it maps to BLANK whatever it is called.
            self.vocab[vocab[pad]] = "<pad>"
        log.info("loaded %s with %d labels", name, len(self.vocab))

    def log_probs(self, audio: np.ndarray) -> np.ndarray:
        torch = self._torch
        inputs = self.features(audio, sampling_rate=16_000, return_tensors="pt")
        with torch.inference_mode():
            logits = self.model(inputs.input_values).logits[0]
        return torch.log_softmax(logits, dim=-1).numpy()
