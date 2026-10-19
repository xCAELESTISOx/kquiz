"""Stage 0 evaluation harness (docs/PLAN.md §9).

    python -m app.eval vocab                       # how the model's labels map to our phones
    python -m app.eval one rec.wav 국물            # score one recording
    python -m app.eval run recordings/manifest.csv # the stage 0 check

The manifest is a CSV with columns file, text, kind, bad:
  file  path relative to the manifest: WAV, or m4a/mp3/... from iPhone Voice Memos (needs ffmpeg)
  text  the Korean word or phrase that was said
  kind  tts | native | mine | broken
  bad   for kind=broken, the 1-based syllables that were said wrong on purpose, e.g. "2" or "1;3"
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import statistics
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from .scoring import Scorer

REFERENCE_KINDS = {"tts", "native"}
REFERENCE_TARGET = 90  # PLAN.md: references must score >= 90
DETECTION_TARGET = 0.5  # "found in most cases"


@dataclass
class Row:
    file: str
    text: str
    kind: str
    bad: list[int]
    score: int | None = None
    statuses: list[str] = field(default_factory=list)
    heard: str = ""
    seconds: float = 0.0
    speech_s: float = 0.0
    error: str = ""

    @property
    def flagged(self) -> list[int]:
        return [i + 1 for i, s in enumerate(self.statuses) if s != "ok"]


def read_manifest(path: Path) -> list[Row]:
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for rec in csv.DictReader(f):
            bad = [int(x) for x in (rec.get("bad") or "").replace(",", ";").split(";") if x.strip()]
            rows.append(Row(rec["file"].strip(), rec["text"].strip(), rec["kind"].strip().lower(), bad))
    return rows


def load_audio(path: Path) -> bytes:
    """WAV as is; anything else (Voice Memos .m4a) is converted with ffmpeg to 16 kHz mono WAV."""
    if path.suffix.lower() == ".wav":
        return path.read_bytes()
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(f"{path.name}: install ffmpeg to read {path.suffix} files, or export WAV")
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "16000", "-f", "wav", "-"]
    return subprocess.run(cmd, check=True, capture_output=True, timeout=30).stdout


def run(rows: list[Row], scorer: Scorer, base: Path) -> list[Row]:
    for row in rows:
        t0 = time.perf_counter()
        try:
            result = scorer.score_wav(load_audio(base / row.file), row.text)
        except Exception as exc:  # report and keep going: one bad file should not stop the run
            row.error = f"{type(exc).__name__}: {exc}"
            continue
        row.seconds = time.perf_counter() - t0
        row.score = result.score
        row.statuses = [s.status for s in result.syllables]
        row.heard = " ".join(result.heard_phones)
        row.speech_s = result.timing_ms.get("speech", 0) / 1000
    return rows


def summarize(rows: list[Row]) -> dict:
    done = [r for r in rows if r.score is not None]
    refs = [r for r in done if r.kind in REFERENCE_KINDS]
    mine = [r for r in done if r.kind == "mine"]
    broken = [r for r in done if r.kind == "broken" and r.bad]

    def share(xs, pred):
        return round(sum(1 for x in xs if pred(x)) / len(xs), 3) if xs else None

    detected = share(broken, lambda r: set(r.bad) <= set(r.flagged))
    pinpoint = share(broken, lambda r: set(r.flagged) == set(r.bad))
    # Broken rows built from a native recording: the bad syllable must be flagged
    # where the same audio against the right text left it alone.
    native_flags = {r.file: set(r.flagged) for r in refs}
    paired = [r for r in broken if r.file in native_flags and not set(r.bad) & native_flags[r.file]]
    caught = share(paired, lambda r: set(r.bad) <= set(r.flagged))
    times = sorted(r.seconds for r in done)
    rtf = [r.seconds / r.speech_s for r in done if r.speech_s]
    out = {
        "files": len(rows),
        "failed": [{"file": r.file, "error": r.error} for r in rows if r.error],
        "references": {
            "count": len(refs),
            "mean_score": round(statistics.mean(r.score for r in refs), 1) if refs else None,
            "share_ge_90": share(refs, lambda r: r.score >= REFERENCE_TARGET),
            "syllables_flagged": share([s for r in refs for s in r.statuses], lambda s: s != "ok"),
            "below_90": [f"{r.file} ({r.score})" for r in refs if r.score < REFERENCE_TARGET],
        },
        "mine": {
            "count": len(mine),
            "mean_score": round(statistics.mean(r.score for r in mine), 1) if mine else None,
            "syllables_flagged": share([s for r in mine for s in r.statuses], lambda s: s != "ok"),
        },
        "broken": {
            "count": len(broken),
            "detected": detected,
            "pinpointed": pinpoint,
            "paired": len(paired),
            "caught_vs_native": caught,
            "missed": [
                f"{r.file} (bad {r.bad}, flagged {r.flagged})"
                for r in broken
                if not set(r.bad) <= set(r.flagged)
            ],
        },
        "speed": {
            "p50_s": round(times[len(times) // 2], 3) if times else None,
            "p95_s": round(times[min(len(times) - 1, int(len(times) * 0.95))], 3) if times else None,
            "real_time_factor": round(statistics.mean(rtf), 3) if rtf else None,
        },
    }
    refs_ok = out["references"]["share_ge_90"]
    out["criteria"] = {
        "references_score_90": None if refs_ok is None else refs_ok >= 0.9,
        "broken_sounds_found": None
        if detected is None
        else (caught if caught is not None else detected) > DETECTION_TARGET,
    }
    return out


def print_table(rows: list[Row]) -> None:
    print(f"{'file':28} {'kind':7} {'text':12} {'score':>5}  syllables      heard")
    for r in rows:
        if r.error:
            print(f"{r.file:28} {r.kind:7} {r.text:12} {'ERR':>5}  {r.error}")
            continue
        marks = "".join({"ok": "·", "weak": "~", "wrong": "x"}[s] for s in r.statuses)
        expect = f" (bad {';'.join(map(str, r.bad))})" if r.bad else ""
        print(f"{r.file:28} {r.kind:7} {r.text:12} {r.score:>5}  {marks + expect:14} {r.heard}")


def cmd_vocab(_args) -> int:
    from .recognizer import CLASSES, Wav2Vec2Recognizer, missing_phones, projection

    rec = Wav2Vec2Recognizer()
    groups, mapping = projection(rec.vocab)
    print(f"model: {rec.name}, {len(rec.vocab)} labels\n")
    for cls, ids in zip(CLASSES, groups, strict=True):
        print(f"{cls:8} <- {' '.join(rec.vocab[i] for i in ids) or '(none)'}")
    unknown = [t for t, c in mapping.items() if c == "?"]
    missing = missing_phones(groups)
    print(f"\nunmapped labels: {' '.join(unknown) or 'none'}")
    print(f"phones the model cannot produce: {' '.join(missing) or 'none'}")
    return 1 if missing else 0


def _scorer() -> Scorer:
    from .recognizer import Wav2Vec2Recognizer

    t0 = time.perf_counter()
    scorer = Scorer(Wav2Vec2Recognizer())
    print(f"model loaded in {time.perf_counter() - t0:.1f} s", file=sys.stderr)
    return scorer


def cmd_one(args) -> int:
    result = _scorer().score_wav(load_audio(Path(args.wav)), args.text)
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    return 0


def cmd_run(args) -> int:
    manifest = Path(args.manifest)
    rows = run(read_manifest(manifest), _scorer(), manifest.parent)
    print_table(rows)
    summary = summarize(rows)
    print()
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.json:
        report = {"summary": summary, "rows": [r.__dict__ for r in rows]}
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.eval", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("vocab", help="show how model labels map to canonical phones").set_defaults(fn=cmd_vocab)
    one = sub.add_parser("one", help="score one recording")
    one.add_argument("wav")
    one.add_argument("text")
    one.set_defaults(fn=cmd_one)
    r = sub.add_parser("run", help="score every recording in a manifest")
    r.add_argument("manifest")
    r.add_argument("--json", help="also write the full report here")
    r.set_defaults(fn=cmd_run)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
