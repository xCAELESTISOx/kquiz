import os

import pytest
from fastapi.testclient import TestClient

from app.main import MAX_BODY_BYTES, app
from app.scoring import Scorer

from .fake import FakeRecognizer, tone_wav

os.environ["SCORER_LOAD_MODEL"] = "0"


@pytest.fixture
def client():
    app.state.scorer = Scorer(FakeRecognizer(["k", "u", "ŋ", "m", "u", "l"]))
    with TestClient(app) as c:
        yield c
    del app.state.scorer


def test_health(client):
    assert client.get("/health").json() == {"ok": True, "model": True}


def test_g2p(client):
    body = client.get("/g2p", params={"text": "국물"}).json()
    assert body["pronunciation"] == "궁물"
    assert body["romanization"] == "gungmul"
    assert body["phones"][2] == {"syllable": 0, "position": "coda", "ipa": "ŋ", "jamo": "ㅇ"}


def test_score(client):
    r = client.post(
        "/score", params={"text": "국물"}, content=tone_wav(), headers={"content-type": "audio/wav"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["score"] == 100
    assert [s["status"] for s in body["syllables"]] == ["ok", "ok"]


def test_rejects_bad_text(client):
    assert client.post("/score", params={"text": "abc"}, content=tone_wav()).status_code == 422
    assert client.get("/g2p", params={"text": "abc"}).status_code == 422


def test_rejects_large_and_bad_audio(client):
    big = b"\0" * (MAX_BODY_BYTES + 1)
    assert client.post("/score", params={"text": "국물"}, content=big).status_code == 413
    assert client.post("/score", params={"text": "국물"}, content=b"junk").status_code == 422


def test_no_model():
    app.state.scorer = None
    app.state.model_error = None
    with TestClient(app) as c:
        assert c.post("/score", params={"text": "국물"}, content=tone_wav()).status_code == 503
        assert c.get("/health").json()["model"] is False
    del app.state.scorer
