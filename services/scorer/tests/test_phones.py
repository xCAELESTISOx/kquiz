from app.phones import (
    BLANK,
    OTHER,
    decompose,
    normalize_token,
    substitution_cost,
    syllable_phones,
)


def test_decompose():
    assert decompose("가") == ("ㄱ", "ㅏ", "")
    assert decompose("닭") == ("ㄷ", "ㅏ", "ㄺ")
    assert decompose("힣") == ("ㅎ", "ㅣ", "ㅎ")


def test_syllable_phones():
    assert [p.phone for p in syllable_phones("궁", 0)] == ["k", "u", "ŋ"]
    assert [p.phone for p in syllable_phones("의", 0)] == ["ɰ", "i"]
    assert [p.phone for p in syllable_phones("왜", 0)] == ["w", "e"]
    assert [p.position for p in syllable_phones("밖", 0)] == ["onset", "vowel", "coda"]


def test_normalize_token():
    assert normalize_token("<pad>") == BLANK
    assert normalize_token("|") == BLANK
    assert normalize_token("k͈") == "k͈"
    assert normalize_token("k*") == "k͈"
    assert normalize_token("kk") == "k͈"
    assert normalize_token("kʰ") == "kʰ"
    assert normalize_token("kh") == "kʰ"
    assert normalize_token("k̚") == "k"
    assert normalize_token("ɡ") == "k"
    assert normalize_token("b") == "p"
    assert normalize_token("dʑ") == "tɕ"
    assert normalize_token("t͈ɕ") == "t͈ɕ"
    assert normalize_token("tɕʰ") == "tɕʰ"
    assert normalize_token("ɕ͈") == "s͈"
    assert normalize_token("ɾ") == "l"
    assert normalize_token("ɛ") == "e"
    assert normalize_token("aː") == "a"
    assert normalize_token("θ") == OTHER


def test_costs():
    assert substitution_cost("k", "k") == 0
    assert substitution_cost("k", "kʰ") <= 0.5  # ㄱ/ㅋ is a near miss
    assert substitution_cost("ʌ", "o") <= 0.5  # ㅓ/ㅗ is a near miss
    assert substitution_cost("k", "m") > 0.5
    assert substitution_cost("a", "k") == 1.0
