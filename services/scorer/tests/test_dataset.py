import csv

from app import dataset
from app.dataset import build_manifest, commons_files, compose, mutations


def test_compose():
    assert compose("ㄷ", "ㅏ", "ㄹ") == "달"
    assert compose("ㄲ", "ㅗ", "") == "꼬"


def test_mutations_change_one_syllable():
    muts = mutations("달")
    assert ("딸", 0) in muts and ("탈", 0) in muts
    assert all(k == 0 for _, k in muts)


def test_mutations_skip_changes_g2p_undoes():
    # 학교 is already pronounced 학꾜, so 학꾜 is not a mispronunciation of it
    assert ("학꾜", 1) not in mutations("학교")
    assert any(k == 1 for _, k in mutations("학교"))


def test_build_manifest(tmp_path):
    files = [{"file": "audio/달-a.wav", "word": "달"}]
    assert build_manifest(files, tmp_path) == 2
    rows = list(csv.DictReader((tmp_path / "manifest.csv").open(encoding="utf-8")))
    assert rows[0] == {"file": "audio/달-a.wav", "text": "달", "kind": "native", "bad": ""}
    assert rows[1]["kind"] == "broken" and rows[1]["bad"] == "1" and rows[1]["text"] != "달"


def test_commons_files_parses_api(monkeypatch):
    page = {
        "title": "File:LL-Q9176 (kor)-Someone-학교.wav",
        "imageinfo": [
            {
                "url": "https://upload.wikimedia.org/x.wav",
                "user": "Someone",
                "extmetadata": {"LicenseShortName": {"value": "CC BY-SA 4.0"}},
            }
        ],
    }
    skipped = {**page, "title": "File:LL-Q9176 (kor)-Someone-hello.wav"}
    monkeypatch.setattr(dataset, "_get", lambda params: {"query": {"pages": [page, skipped]}})
    (f,) = commons_files(10)
    assert f["word"] == "학교" and f["license"] == "CC BY-SA 4.0"
