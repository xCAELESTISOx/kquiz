import shutil
import subprocess

import pytest

from app.audio import decode_wav
from app.eval import load_audio, read_manifest, run, summarize
from app.scoring import Scorer

from .fake import FakeRecognizer, tone_wav


class QueueRecognizer(FakeRecognizer):
    """Hears the next label list for each recording, in manifest order."""

    def __init__(self, heard):
        super().__init__([])
        self.queue = list(heard)

    def log_probs(self, audio):
        self.labels = self.queue.pop(0)
        return super().log_probs(audio)


def test_run_and_summary(tmp_path):
    for name in ("a.wav", "b.wav", "c.wav"):
        (tmp_path / name).write_bytes(tone_wav())
    (tmp_path / "manifest.csv").write_text(
        "file,text,kind,bad\n"
        "a.wav,국물,tts,\n"
        "b.wav,국물,broken,1\n"
        "c.wav,국물,mine,\n"
        "missing.wav,국물,mine,\n",
        encoding="utf-8",
    )
    perfect = ["k", "u", "ŋ", "m", "u", "l"]
    scorer = Scorer(QueueRecognizer([perfect, ["k", "u", "k", "m", "u", "l"], perfect]))
    rows = run(read_manifest(tmp_path / "manifest.csv"), scorer, tmp_path)
    s = summarize(rows)
    assert s["references"] == {"count": 1, "mean_score": 100, "share_ge_90": 1.0, "below_90": []}
    assert s["broken"]["detected"] == 1.0 and s["broken"]["pinpointed"] == 1.0
    assert s["mine"]["syllables_flagged"] == 0.0
    assert s["criteria"] == {"references_score_90": True, "broken_sounds_found": True}
    assert len(s["failed"]) == 1 and s["failed"][0]["file"] == "missing.wav"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_load_audio_converts_voice_memos(tmp_path):
    wav = tmp_path / "a.wav"
    wav.write_bytes(tone_wav())
    m4a = tmp_path / "a.m4a"
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(wav), "-c:a", "aac", str(m4a)], check=True)
    x, rate = decode_wav(load_audio(m4a))
    assert rate == 16_000 and 1.5 < len(x) / rate < 2.5
