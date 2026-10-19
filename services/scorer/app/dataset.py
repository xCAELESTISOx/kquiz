"""Stage 0 data without recording anything yourself.

    python -m app.dataset commons recordings/commons --limit 60

1. Downloads native Korean word recordings from Wikimedia Commons (Lingua
   Libre, CC BY-SA; the author of each file is kept in the manifest).
2. Writes a manifest for app.eval: each recording once as `native`, and once
   more as `broken` with a text that differs from what was said in exactly one
   sound (달 said, 딸 expected). The scorer must flag that syllable.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .g2p import InvalidText, reference
from .phones import is_syllable

API = "https://commons.wikimedia.org/w/api.php"
CATEGORY = "Category:Lingua Libre pronunciation-kor"
USER_AGENT = "kquiz-scorer-eval/0.1 (personal pronunciation trainer; https://github.com/xCAELESTISOx/kquiz)"

_ONSETS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_VOWELS = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
_CODAS = ["", *"ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"]

# Swaps a learner actually confuses (near) and clearly different sounds (far).
ONSET_SWAPS = {
    "ㄱ": "ㄲㅋㅁ",
    "ㄲ": "ㄱㅋ",
    "ㅋ": "ㄱㄲ",
    "ㄷ": "ㄸㅌㄴ",
    "ㄸ": "ㄷㅌ",
    "ㅌ": "ㄷㄸ",
    "ㅂ": "ㅃㅍㅁ",
    "ㅃ": "ㅂㅍ",
    "ㅍ": "ㅂㅃ",
    "ㅈ": "ㅉㅊ",
    "ㅉ": "ㅈㅊ",
    "ㅊ": "ㅈㅉ",
    "ㅅ": "ㅆㄷ",
    "ㅆ": "ㅅ",
    "ㄴ": "ㄷㅁ",
    "ㅁ": "ㅂㄴ",
    "ㄹ": "ㄴ",
    "ㅎ": "ㄱ",
}
VOWEL_SWAPS = {
    "ㅓ": "ㅗㅏ",
    "ㅗ": "ㅓㅜ",
    "ㅜ": "ㅡㅗ",
    "ㅡ": "ㅜㅓ",
    "ㅏ": "ㅓㅣ",
    "ㅣ": "ㅡㅔ",
    "ㅔ": "ㅣㅏ",
    "ㅐ": "ㅣㅏ",
    "ㅕ": "ㅛ",
    "ㅛ": "ㅕ",
}
CODA_SWAPS = {"ㄴ": "ㅁㅇ", "ㅁ": "ㄴㅇ", "ㅇ": "ㄴㅁ", "ㄱ": "ㅂㄷ", "ㅂ": "ㄱㄷ", "ㄹ": "ㄴ"}


def compose(onset: str, vowel: str, coda: str) -> str:
    return chr(0xAC00 + _ONSETS.index(onset) * 588 + _VOWELS.index(vowel) * 28 + _CODAS.index(coda))


def _parts(syl: str) -> tuple[str, str, str]:
    code = ord(syl) - 0xAC00
    return _ONSETS[code // 588], _VOWELS[(code % 588) // 28], _CODAS[code % 28]


def mutations(word: str) -> list[tuple[str, int]]:
    """Every one-sound change of `word` whose pronounced form differs only in that syllable.

    g2p rules can undo a change (학교 is already said 학꾜, so 학꾜 is not an
    error), so each candidate is checked against the reference phones.
    """
    try:
        base = reference(word)
    except InvalidText:
        return []
    chars = list(word)
    syl_pos = [i for i, c in enumerate(chars) if is_syllable(c)]
    out = []
    for k, pos in enumerate(syl_pos):
        onset, vowel, coda = _parts(chars[pos])
        cands = [compose(o, vowel, coda) for o in ONSET_SWAPS.get(onset, "")]
        cands += [compose(onset, v, coda) for v in VOWEL_SWAPS.get(vowel, "")]
        cands += [compose(onset, vowel, c) for c in CODA_SWAPS.get(coda, "")]
        for new in cands:
            text = "".join([*chars[:pos], new, *chars[pos + 1 :]])
            ref = reference(text)
            if len(ref.phones) != len(base.phones):
                continue
            diff = {a.syllable for a, b in zip(base.phones, ref.phones, strict=True) if a.phone != b.phone}
            if diff == {k}:
                out.append((text, k))
    return out


def _open(url: str, attempts: int = 6):
    """urlopen with a polite User-Agent, backing off when Wikimedia rate-limits (HTTP 429)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            return urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == attempts - 1:
                raise
            time.sleep(int(exc.headers.get("Retry-After") or 0) or 2 ** (attempt + 2))
    raise AssertionError("unreachable")


def _get(params: dict) -> dict:
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    with _open(url) as resp:
        return json.load(resp)


def commons_files(limit: int) -> list[dict]:
    """Lingua Libre Korean files with a single-word title, with download URL and author."""
    files: list[dict] = []
    cont: dict = {}
    while len(files) < limit:
        data = _get(
            {
                "action": "query",
                "generator": "categorymembers",
                "gcmtitle": CATEGORY,
                "gcmtype": "file",
                "gcmlimit": "50",
                "prop": "imageinfo",
                "iiprop": "url|user|extmetadata",
                "iiextmetadatafilter": "LicenseShortName",
                **cont,
            }
        )
        for page in data.get("query", {}).get("pages", []):
            title = page["title"]  # File:LL-Q9176 (kor)-Speaker-단어.wav
            word = title.rsplit("-", 1)[-1].rsplit(".", 1)[0].strip()
            if not word or not all(is_syllable(c) for c in word) or len(word) > 4:
                continue
            info = page["imageinfo"][0]
            lic = info.get("extmetadata", {}).get("LicenseShortName", {}).get("value", "")
            files.append(
                {"title": title, "word": word, "url": info["url"], "user": info["user"], "license": lic}
            )
        if "continue" not in data:
            break
        cont = data["continue"]
    return files[:limit]


def download(url: str, dest: Path) -> None:
    with _open(url) as resp:
        dest.write_bytes(resp.read())


def build_manifest(files: list[dict], out: Path, seed: int = 0) -> int:
    """Manifest rows for downloaded files: native as is, plus one broken variant each."""
    rng = random.Random(seed)
    rows = []
    for f in files:
        rows.append({"file": f["file"], "text": f["word"], "kind": "native", "bad": ""})
        muts = mutations(f["word"])
        if muts:
            text, k = rng.choice(muts)
            rows.append({"file": f["file"], "text": text, "kind": "broken", "bad": str(k + 1)})
    with (out / "manifest.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["file", "text", "kind", "bad"])
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def cmd_commons(args) -> int:
    out = Path(args.out)
    (out / "audio").mkdir(parents=True, exist_ok=True)
    files = commons_files(args.limit)
    credits = []
    for f in files:
        name = f"audio/{f['word']}-{re.sub(r'[^\w-]', '_', f['user'])}.wav"
        dest = out / name
        if not dest.exists():
            download(f["url"], dest)
            time.sleep(args.delay)
        f["file"] = name
        credits.append(f"{name}\t{f['title']}\t{f['user']}\t{f['license']}")
    (out / "CREDITS.tsv").write_text(
        "file\tsource\tauthor\tlicense\n" + "\n".join(credits) + "\n", encoding="utf-8"
    )
    n = build_manifest(files, out, args.seed)
    print(f"{len(files)} recordings, {n} manifest rows in {out / 'manifest.csv'}", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.dataset",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("commons", help="download Lingua Libre recordings and write a manifest")
    c.add_argument("out")
    c.add_argument("--limit", type=int, default=60)
    c.add_argument("--seed", type=int, default=0)
    c.add_argument("--delay", type=float, default=1.0, help="seconds between downloads")
    c.set_defaults(fn=cmd_commons)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
