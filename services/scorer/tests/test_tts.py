import io

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app import tts
from app.main import app

RATE = 44_100


class FakeSynth:
    """Half a second of silence, a 220 Hz tone with a 20 Hz hum, then silence again."""

    sample_rate = RATE

    def __init__(self, silent: bool = False):
        self.silent = silent
        self.calls: list[tuple[str, str]] = []

    def synthesize(self, text: str, voice: str) -> np.ndarray:
        self.calls.append((text, voice))
        t = np.arange(RATE) / RATE
        tone = 0.0 if self.silent else 0.3 * np.sin(2 * np.pi * 220 * t) + 0.05 * np.sin(2 * np.pi * 20 * t)
        pad = np.zeros(RATE // 2)
        return np.concatenate([pad, tone, pad]).astype(np.float32)


def band_power(x: np.ndarray, lo: float, hi: float) -> float:
    spectrum = np.abs(np.fft.rfft(x)) ** 2
    freqs = np.fft.rfftfreq(len(x), 1 / RATE)
    return float(spectrum[(freqs >= lo) & (freqs < hi)].sum())


def test_highpass_removes_hum_keeps_voice():
    x = FakeSynth().synthesize("", "F1")
    y = tts.highpass(x, RATE)
    assert band_power(y, 10, 30) < band_power(x, 10, 30) * 1e-3
    assert band_power(y, 200, 240) == pytest.approx(band_power(x, 200, 240), rel=0.01)


def test_trim_cuts_padding():
    y = tts.trim(FakeSynth().synthesize("", "F1"), RATE)
    assert 1.0 <= len(y) / RATE < 1.15
    assert y[0] == 0 and y[-1] == 0  # faded edges, no clicks


def test_speak_returns_mp3():
    synth = FakeSynth()
    mp3 = tts.speak(synth, "국물", "M1")
    audio, rate = sf.read(io.BytesIO(mp3))
    assert rate == RATE
    assert 1.0 <= len(audio) / rate < 1.3
    assert synth.calls == [("국물", "M1")]


def test_speak_rejects_silence():
    with pytest.raises(ValueError):
        tts.speak(FakeSynth(silent=True), "국물")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SCORER_LOAD_MODEL", "0")
    app.state.synth = FakeSynth()
    with TestClient(app) as c:
        yield c
    del app.state.synth


def test_tts_endpoint(client):
    r = client.post("/tts", params={"text": " 국물 "})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert app.state.synth.calls == [("국물", tts.DEFAULT_VOICE)]


def test_tts_endpoint_takes_a_voice(client):
    r = client.post("/tts", params={"text": "국물", "voice": "M3"})
    assert r.status_code == 200
    assert r.headers["x-tts-voice"] == "M3"
    assert app.state.synth.calls == [("국물", "M3")]
    assert client.post("/tts", params={"text": "국물", "voice": "X9"}).status_code == 422


def test_tts_endpoint_rejects_bad_text(client):
    assert client.post("/tts", params={"text": "  "}).status_code == 422
    assert client.post("/tts", params={"text": "가" * (tts.MAX_TEXT + 1)}).status_code == 422


def test_idle_model_is_unloaded(client):
    from app.main import TTS_IDLE_S, unload_idle_synth

    state = app.state
    client.post("/tts", params={"text": "국물"})
    used = state.synth_used_at
    assert not unload_idle_synth(state, used + TTS_IDLE_S - 1)
    assert state.synth is not None
    assert unload_idle_synth(state, used + TTS_IDLE_S)
    assert state.synth is None
    app.state.synth = FakeSynth()  # the fixture's teardown expects one
