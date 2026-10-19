import numpy as np
import pytest

from app.audio import InvalidAudio, decode_wav, prepare, resample, to_wav, trim_silence

from .fake import tone_wav


def test_roundtrip_and_resample():
    x, rate = decode_wav(tone_wav(1.0, rate=48_000, lead=0))
    assert rate == 48_000
    assert len(resample(x, rate)) == 16_000


def test_trim_keeps_margin():
    x, _ = decode_wav(tone_wav(1.0, lead=1.0))
    y = trim_silence(x)
    assert 1.3 * 16_000 <= len(y) <= 1.5 * 16_000


def test_prepare_normalizes():
    y = prepare(tone_wav(0.5))
    assert abs(np.abs(y).max() - 0.9) < 0.01


def test_rejects_silence_long_and_garbage():
    with pytest.raises(InvalidAudio):
        prepare(to_wav(np.zeros(16_000)))
    with pytest.raises(InvalidAudio):
        prepare(tone_wav(11.0, lead=0))
    with pytest.raises(InvalidAudio):
        prepare(b"not a wav")
