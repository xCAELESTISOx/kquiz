"""Alignment of what was heard against what was expected (PLAN.md §4.3 steps 4-5)."""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

import numpy as np

from .phones import deletion_cost, insertion_cost, substitution_cost


@dataclass(frozen=True)
class Op:
    kind: str  # match / sub / del / ins
    target: int | None  # index into the expected sequence
    heard: int | None  # index into the heard sequence
    cost: float


def weighted_levenshtein(expected: list[str], heard: list[str]) -> list[Op]:
    """Minimum-cost edit script; near substitutions are cheaper than far ones."""
    n, m = len(expected), len(heard)
    d = np.zeros((n + 1, m + 1))
    for i in range(1, n + 1):
        d[i, 0] = d[i - 1, 0] + deletion_cost(expected[i - 1])
    for j in range(1, m + 1):
        d[0, j] = d[0, j - 1] + insertion_cost(heard[j - 1])
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(
                d[i - 1, j - 1] + substitution_cost(expected[i - 1], heard[j - 1]),
                d[i - 1, j] + deletion_cost(expected[i - 1]),
                d[i, j - 1] + insertion_cost(heard[j - 1]),
            )
    ops: list[Op] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0:
            c = substitution_cost(expected[i - 1], heard[j - 1])
            if np.isclose(d[i, j], d[i - 1, j - 1] + c):
                ops.append(Op("match" if c == 0 else "sub", i - 1, j - 1, c))
                i, j = i - 1, j - 1
                continue
        if i > 0 and np.isclose(d[i, j], d[i - 1, j] + deletion_cost(expected[i - 1])):
            ops.append(Op("del", i - 1, None, deletion_cost(expected[i - 1])))
            i -= 1
            continue
        ops.append(Op("ins", None, j - 1, insertion_cost(heard[j - 1])))
        j -= 1
    ops.reverse()
    return ops


def ctc_greedy(logp: np.ndarray, blank: int) -> list[int]:
    """Best path: argmax per frame, collapse repeats, drop blanks."""
    best = logp.argmax(axis=1)
    out: list[int] = []
    prev = -1
    for b in best:
        if b != prev and b != blank:
            out.append(int(b))
        prev = b
    return out


def ctc_forced_align(logp: np.ndarray, target: list[int], blank: int) -> list[tuple[int, int]] | None:
    """Viterbi CTC alignment: frame span [start, end) of each target label.

    Returns None when the recording has too few frames for the target.
    """
    t_len = logp.shape[0]
    ext = [blank]
    for lab in target:
        ext += [lab, blank]
    s_len = len(ext)
    repeats = sum(1 for a, b in pairwise(target) if a == b)
    if not target or t_len < len(target) + repeats:
        return None
    ext_arr = np.array(ext)
    # Transitions from s-2 are allowed into a label that differs from the one two back.
    skip = np.zeros(s_len, dtype=bool)
    skip[2:] = (ext_arr[2:] != blank) & (ext_arr[2:] != ext_arr[:-2])
    neg = -np.inf
    score = np.full(s_len, neg)
    score[0] = logp[0, ext[0]]
    score[1] = logp[0, ext[1]]
    back = np.zeros((t_len, s_len), dtype=np.int8)  # 0 stay, 1 from s-1, 2 from s-2
    for t in range(1, t_len):
        stay = score
        step = np.concatenate(([neg], score[:-1]))
        jump = np.where(skip, np.concatenate(([neg, neg], score[:-2])), neg)
        stacked = np.stack([stay, step, jump])
        choice = stacked.argmax(axis=0)
        score = stacked[choice, np.arange(s_len)] + logp[t, ext_arr]
        back[t] = choice
    s = s_len - 1 if score[-1] >= score[-2] else s_len - 2
    if not np.isfinite(score[s]):
        return None
    states = np.empty(t_len, dtype=int)
    for t in range(t_len - 1, -1, -1):
        states[t] = s
        s -= back[t, s]
    spans: list[tuple[int, int]] = [(-1, -1)] * len(target)
    for t, st in enumerate(states):
        if st % 2 == 1:
            k = st // 2
            start, _ = spans[k]
            spans[k] = (t if start < 0 else start, t + 1)
    return spans


def goodness(logp: np.ndarray, spans: list[tuple[int, int]], target: list[int]) -> list[float]:
    """GOP-style confidence in (0, 1] for each target label.

    Geometric mean of the posterior of the expected sound over the frames the
    forced alignment gave it: near 1 when the model is sure it heard that sound.
    """
    return [float(np.exp(logp[s:e, lab].mean())) for (s, e), lab in zip(spans, target, strict=True)]
