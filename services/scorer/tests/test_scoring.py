from app.scoring import Scorer

from .fake import FakeRecognizer, tone_wav


def score(heard, text="국물", **kw):
    return Scorer(FakeRecognizer(heard, **kw)).score_wav(tone_wav(), text)


def test_perfect():
    r = score(["k", "u", "ŋ", "m", "u", "l"])
    assert r.score == 100
    assert [s.status for s in r.syllables] == ["ok", "ok"]
    assert r.errors == []
    assert r.syllables[0].text == "국" and r.syllables[0].pron == "궁"


def test_allophones_are_not_errors():
    # voiced [ɡ], unreleased coda, flap [ɾ] for ㄹ are all fine
    r = score(["ɡ", "u", "ŋ", "m", "u", "ɾ"])
    assert r.score == 100


def test_near_miss_is_weak():
    r = score(["kʰ", "u", "ŋ", "m", "u", "l"])
    assert [s.status for s in r.syllables] == ["weak", "ok"]
    (err,) = r.errors
    assert err.kind == "substitution"
    assert err.expected["jamo"] == "ㄱ" and err.heard["jamo"] == "ㅋ"
    assert 80 <= r.score < 95


def test_reading_spelling_instead_of_pronunciation_is_wrong():
    # saying 국 with [k] coda instead of nasalised [ŋ]
    r = score(["k", "u", "k", "m", "u", "l"])
    assert r.syllables[0].status == "wrong"
    assert r.errors[0].position == "coda"
    assert r.score < 92  # never suggested as "good"


def test_missing_sound():
    r = score(["k", "u", "ŋ", "m", "u"])
    assert r.syllables[1].status == "wrong"
    assert r.errors[0].kind == "deletion"


def test_extra_sound():
    r = score(["k", "u", "ŋ", "m", "u", "l", "a"])
    assert r.errors[0].kind == "insertion"
    assert r.score < 100


def test_low_confidence_is_weak():
    r = score(["k", "u", "ŋ", "m", "u", "l"], confidence=0.3)
    assert {e.kind for e in r.errors} == {"unclear"}
    assert [s.status for s in r.syllables] == ["weak", "weak"]
    assert r.score < 92


def test_garbage_scores_low():
    r = score(["a", "a", "s", "i"])
    assert r.score < 40
