"""Reference audio for cards: Supertonic 3 text-to-speech on the CPU.

The API asks for each card once and stores the MP3, so speed matters less than
quality: 32 denoising steps instead of the default 8 remove the hiss the model
leaves in quiet parts, and a slower speed suits a learner.
"""

from __future__ import annotations

import io
import os
from typing import Protocol

import numpy as np
import soundfile as sf

# Built-in voices: F1–F5, M1–M5.
VOICE_PATTERN = r"^[FM][1-5]$"
DEFAULT_VOICE = os.environ.get("TTS_VOICE", "F1")
STEPS = int(os.environ.get("TTS_STEPS", "32"))
SPEED = float(os.environ.get("TTS_SPEED", "0.7"))
MAX_TEXT = 200

# Rumble below this is model noise, not voice: the lowest male voices start around 80 Hz.
HIGHPASS_HZ = 70.0
# Frames quieter than this are the silence the model pads each clip with.
SILENCE_DB = -45.0


class Synthesizer(Protocol):
    sample_rate: int

    def synthesize(self, text: str, voice: str) -> np.ndarray: ...


class SupertonicSynthesizer:
    """Loads the ONNX model on first use; it downloads into SUPERTONIC_CACHE_DIR once."""

    def __init__(self, threads: int | None = None):
        from supertonic import TTS

        self._tts = TTS(intra_op_num_threads=threads, inter_op_num_threads=1)
        self.sample_rate = self._tts.sample_rate
        self._styles: dict = {}

    def synthesize(self, text: str, voice: str) -> np.ndarray:
        style = self._styles.get(voice)
        if style is None:
            style = self._styles[voice] = self._tts.get_voice_style(voice)
        wav, _ = self._tts.synthesize(text, voice_style=style, lang="ko", total_steps=STEPS, speed=SPEED)
        return np.asarray(wav, dtype=np.float32).reshape(-1)


def highpass(x: np.ndarray, rate: int, cutoff: float = HIGHPASS_HZ) -> np.ndarray:
    """Removes low-frequency rumble with a short ramp in the spectrum, so no ringing."""
    if len(x) == 0:
        return x
    spectrum = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / rate)
    spectrum *= np.clip((freqs - cutoff / 2) / (cutoff / 2), 0.0, 1.0)
    return np.fft.irfft(spectrum, n=len(x)).astype(np.float32)


def trim(x: np.ndarray, rate: int, threshold_db: float = SILENCE_DB) -> np.ndarray:
    """Cuts the padded silence around the speech, keeping a short margin, and fades the edges."""
    frame = max(1, int(rate * 0.01))
    n = len(x) // frame
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1))
    loud = np.flatnonzero(20 * np.log10(rms + 1e-9) > threshold_db)
    if len(loud) == 0:
        return x[:0]
    start = max(0, (loud[0] - 3) * frame)
    end = min(len(x), (loud[-1] + 8) * frame)
    y = x[start:end].copy()
    fade_in, fade_out = min(len(y), int(rate * 0.01)), min(len(y), int(rate * 0.04))
    y[:fade_in] *= np.linspace(0, 1, fade_in, dtype=np.float32)
    y[len(y) - fade_out :] *= np.linspace(1, 0, fade_out, dtype=np.float32)
    return y


def to_mp3(x: np.ndarray, rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(x, -1, 1), rate, format="MP3")
    return buf.getvalue()


def speak(synth: Synthesizer, text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """Text -> cleaned-up MP3."""
    audio = synth.synthesize(text, voice)
    audio = trim(highpass(audio, synth.sample_rate), synth.sample_rate)
    if len(audio) == 0:
        raise ValueError("the model produced only silence")
    return to_mp3(audio, synth.sample_rate)
