"""WAV decoding and clean-up before recognition (docs/PLAN.md §4.3 step 1)."""

from __future__ import annotations

import io
import wave

import numpy as np

SAMPLE_RATE = 16_000
MAX_SECONDS = 10.0
MIN_SPEECH_SECONDS = 0.15
PAD_SECONDS = 0.2


class InvalidAudio(ValueError):
    pass


def decode_wav(data: bytes) -> tuple[np.ndarray, int]:
    """PCM WAV -> mono float32 in [-1, 1] and its sample rate."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            channels, width, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
            frames = w.readframes(w.getnframes())
    except (wave.Error, EOFError) as exc:
        raise InvalidAudio(f"not a PCM WAV file: {exc}") from exc
    if width == 2:
        x = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        x = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    elif width == 1:
        x = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise InvalidAudio(f"unsupported sample width: {width * 8} bit")
    if channels > 1:
        x = x[: len(x) - len(x) % channels].reshape(-1, channels).mean(axis=1)
    return x, rate


def resample(x: np.ndarray, rate: int, target: int = SAMPLE_RATE) -> np.ndarray:
    if rate == target or len(x) == 0:
        return x
    n = round(len(x) * target / rate)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def trim_silence(x: np.ndarray, rate: int = SAMPLE_RATE, pad: float = PAD_SECONDS) -> np.ndarray:
    """Cut leading/trailing silence, keeping `pad` seconds of margin."""
    frame = int(rate * 0.02)
    if len(x) < frame:
        return x
    n = len(x) // frame
    energy = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1))
    # Relative to the loudest frame, with a floor so pure noise is not "speech".
    threshold = max(energy.max() * 0.05, 1e-3)
    voiced = np.flatnonzero(energy > threshold)
    if len(voiced) == 0:
        return x[:0]
    margin = int(pad * rate)
    start = max(voiced[0] * frame - margin, 0)
    end = min((voiced[-1] + 1) * frame + margin, len(x))
    return x[start:end]


def normalize(x: np.ndarray) -> np.ndarray:
    peak = float(np.abs(x).max()) if len(x) else 0.0
    if peak < 1e-4:
        return x
    return (x / peak * 0.9).astype(np.float32)


def prepare(data: bytes) -> np.ndarray:
    """Bytes from the client -> 16 kHz mono speech ready for the model."""
    x, rate = decode_wav(data)
    if len(x) / rate > MAX_SECONDS + 0.05:
        raise InvalidAudio(f"recording is longer than {MAX_SECONDS:g} s")
    x = trim_silence(resample(x, rate))
    if len(x) < MIN_SPEECH_SECONDS * SAMPLE_RATE:
        raise InvalidAudio("no speech found in the recording")
    return normalize(x)


def to_wav(x: np.ndarray, rate: int = SAMPLE_RATE) -> bytes:
    """Float samples -> 16-bit PCM WAV (used by tests and the eval harness)."""
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()
