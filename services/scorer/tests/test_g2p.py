import pytest

from app.g2p import InvalidText, clean_text, reference, romanize


@pytest.mark.parametrize(
    ("text", "pron"),
    [("국물", "궁물"), ("같이", "가치"), ("좋아요", "조아요"), ("학교", "학꾜"), ("신라", "실라")],
)
def test_pronunciation(text, pron):
    assert reference(text).pronunciation == pron


def test_reference_keeps_written_syllables():
    ref = reference("국물")
    assert ref.syllables == ["국", "물"]
    assert ref.pron_syllables == ["궁", "물"]
    assert [p.phone for p in ref.phones] == ["k", "u", "ŋ", "m", "u", "l"]
    assert [p.syllable for p in ref.phones] == [0, 0, 0, 1, 1, 1]


@pytest.mark.parametrize(
    ("text", "rr"),
    [
        ("학교", "hakgyo"),
        ("국물", "gungmul"),
        ("신라", "silla"),
        ("같이", "gachi"),
        ("감사합니다", "gamsahamnida"),
        ("안녕하세요", "annyeonghaseyo"),
        ("물고기", "mulgogi"),
    ],
)
def test_romanization(text, rr):
    assert reference(text).romanization == rr


def test_romanize_without_written_form():
    assert romanize("궁물") == "gungmul"


@pytest.mark.parametrize("bad", ["", "   ", "hello", "국물1", "가" * 41])
def test_rejects_bad_text(bad):
    with pytest.raises(InvalidText):
        clean_text(bad)


def test_accepts_punctuation():
    assert clean_text(" 안녕하세요! ") == "안녕하세요!"
