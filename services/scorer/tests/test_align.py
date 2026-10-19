import numpy as np

from app.align import ctc_forced_align, ctc_greedy, goodness, weighted_levenshtein


def test_identical():
    ops = weighted_levenshtein(["k", "u", "ŋ"], ["k", "u", "ŋ"])
    assert [o.kind for o in ops] == ["match"] * 3


def test_near_substitution_beats_delete_insert():
    ops = weighted_levenshtein(["k", "a"], ["kʰ", "a"])
    assert [o.kind for o in ops] == ["sub", "match"]
    assert ops[0].cost <= 0.5


def test_deletion_and_insertion():
    ops = weighted_levenshtein(["m", "u", "l"], ["m", "u"])
    assert [o.kind for o in ops] == ["match", "match", "del"]
    ops = weighted_levenshtein(["m", "u"], ["m", "u", "l"])
    assert [o.kind for o in ops] == ["match", "match", "ins"]


def _logp(path, classes=4):
    p = np.full((len(path), classes), 0.01)
    for t, c in enumerate(path):
        p[t, c] = 0.97
    return np.log(p)


def test_ctc_greedy_collapses():
    assert ctc_greedy(_logp([0, 1, 1, 0, 1, 2, 2, 0]), blank=0) == [1, 1, 2]


def test_forced_align_spans_and_goodness():
    logp = _logp([0, 1, 1, 0, 2, 2, 2, 0, 3])
    spans = ctc_forced_align(logp, [1, 2, 3], blank=0)
    assert spans == [(1, 3), (4, 7), (8, 9)]
    conf = goodness(logp, spans, [1, 2, 3])
    assert all(c > 0.95 for c in conf)


def test_forced_align_too_short():
    assert ctc_forced_align(_logp([1]), [1, 1], blank=0) is None
