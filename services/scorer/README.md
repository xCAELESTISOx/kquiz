# kquiz-scorer

Internal pronunciation scoring and TTS service (docs/PLAN.md §4.3). It listens on `127.0.0.1` only; `apps/api` calls it after checking the session and the rate limits.

## Running

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m nltk.downloader cmudict          # g2pkiwi reads the dictionary on import
# the model (on a server without a GPU, torch from the CPU index):
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-ml.txt
uvicorn app.main:app --host 127.0.0.1 --port 8788
```

Without the ML requirements, start it with `SCORER_LOAD_MODEL=0`: `/g2p` works, while `/score` answers 503 and `/tts` fails (it needs `supertonic` from `requirements-ml.txt`).

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `SCORER_MODEL` | `slplab/wav2vec2-xls-r-300m_phone-mfa_korean` | Hugging Face model id or a local path |
| `SCORER_THREADS` | torch's default (Docker Compose sets 2) | torch threads |
| `SCORER_QUANTIZE` | `1` | `1` quantizes the model's linear layers to int8 on load: ~1.7x faster on CPU, same scores on the stage 0 set; `0` keeps float32 |
| `SCORER_TIMEOUT` | `15` | Seconds per scoring job |
| `SCORER_LOAD_MODEL` | `1` | `0` skips loading the scoring model: `/g2p` and `/tts` still work, `/score` answers 503 |
| `TTS_VOICE` | `F1` | Default Supertonic voice: `F1`–`F5`, `M1`–`M5` |
| `TTS_SPEED` | `0.7` | Speech rate (0.7 is the model's minimum) |
| `TTS_STEPS` | `32` | Synthesis steps; more is slower and cleaner |
| `TTS_TIMEOUT` | `60` | Seconds per TTS job |
| `TTS_IDLE` | `300` | Seconds without TTS requests before the TTS model is unloaded |

## API

| Request | Response |
|---|---|
| `GET /health` | `{"ok": true, "model": true}` |
| `GET /g2p?text=국물` | `{"text", "pronunciation": "궁물", "romanization": "gungmul", "phones": [{"syllable", "position", "ipa", "jamo"}]}`, used to autofill a card |
| `POST /score?text=국물`, body: WAV | the result below |
| `POST /tts?text=…&voice=F1` | MP3 (`audio/mpeg`, header `X-TTS-Voice`); called by the API's background worker only |

`/score` response:

```json
{
  "score": 70,
  "text": "국물",
  "pronunciation": "궁물",
  "syllables": [{"text": "국", "pron": "궁", "status": "wrong"}, {"text": "물", "pron": "물", "status": "ok"}],
  "errors": [{"syllable": 0, "position": "coda", "kind": "substitution", "status": "wrong",
              "expected": {"ipa": "ŋ", "jamo": "ㅇ"}, "heard": {"ipa": "k", "jamo": "ㄱ"}}],
  "target_phones": ["k", "u", "ŋ", "m", "u", "l"],
  "heard_phones": ["k", "u", "k", "m", "u", "l"],
  "confidence": [0.97, 0.95, 0.4, 0.96, 0.98, 0.9],
  "timing_ms": {"audio": 3, "model": 420, "align": 2, "speech": 1100}
}
```

`status`: `ok` / `weak` / `wrong`. `kind`: `substitution`, `deletion`, `insertion` (an extra sound, `position: "extra"`), `unclear` (the right sound, but the model isn't confident).

Errors: `422` bad text or recording (not WAV, silence, longer than 10 s), `413` body larger than 1 MB, `503` model not loaded or two jobs already waiting, `504` job didn't finish in 15 s. Jobs run strictly one at a time.

Recording: WAV PCM, ideally 16 kHz mono 16-bit (what the PWA records). Other sample rates and stereo are accepted and converted to 16 kHz mono.

## How the score is computed

1. WAV → 16 kHz mono, silence trimmed with 200 ms of margin, loudness normalized.
2. The wav2vec2 model gives per-frame probabilities of its labels. The labels are mapped onto our phone set (`app/phones.py`): allophones such as voiced [ɡ], unreleased [k̚] or [ɾ] for ㄹ are not errors, and ㅐ = ㅔ.
3. Reference: g2pkiwi gives the spoken form (국물 → 궁물), which is split into phones syllable by syllable.
4. What was heard is aligned with the reference by weighted Levenshtein: ㄱ/ㅋ/ㄲ and ㅓ/ㅗ are close substitutions (weak), distant ones are wrong. A lost glide (계 [ke]) and a weak ㅎ cost little.
5. Forced CTC alignment of the reference gives a confidence for each sound; a matching sound with low confidence is weak.
6. The score is the mean over syllables; a syllable with an error is capped (weak ≤ 80, wrong ≤ 40), so one error in a short word can't still earn "good".

The thresholds (`app/scoring.py`) were tuned during stage 0 (docs/PLAN.md §9).

## Evaluating on your own recordings

```sh
pip install -r requirements-ml.txt   # plus torch, see above
python -m app.eval vocab             # how the model's labels map onto our phones; exits 1 if the model lacks a sound
python -m app.eval one rec.wav 국물  # one file, full response
python -m app.eval run recordings/manifest.csv --json recordings/report.json
```

Recordings go in `services/scorer/recordings/` (git-ignored, so no voice ends up in the repository). `manifest.csv` follows `eval/manifest.example.csv`:

| Column | What to put |
|---|---|
| `file` | path relative to the manifest: `.wav`, or `.m4a` from a phone's voice recorder (m4a needs `ffmpeg`) |
| `text` | the word that was said |
| `kind` | `tts` or `native` for references, `mine` for your own attempt, `broken` for a deliberately mispronounced one |
| `bad` | for `broken`: the numbers of the mispronounced syllables, from 1, separated by `;` |

The report shows the share of references scoring ≥ 90 (the stage 0 criterion), the share of broken syllables that were caught, how many syllables were flagged in ordinary recordings, and the speed (p50/p95 and the ratio to speech duration).

### Without your own recordings

```sh
python -m app.dataset commons recordings/commons --limit 60
python -m app.eval run recordings/commons/manifest.csv
```

This downloads native speakers' word recordings from Wikimedia Commons (Lingua Libre, CC BY-SA, authors in `CREDITS.tsv`). Each recording goes into the manifest twice: as `native` with the correct text, and as `broken` with a text that differs by exactly one sound (달 said, 딸 expected). Changes that the pronunciation rules cancel out (학교 sounds like 학꾜 anyway) are dropped. It needs access to `commons.wikimedia.org` and `upload.wikimedia.org`; Wikimedia rate-limits requests from shared cloud addresses.

A fallback source is short utterances from the test split of Zeroth Korean (CC BY 4.0, Hugging Face); it needs `pyarrow` and `ffmpeg`:

```sh
pip install pyarrow
python -m app.dataset zeroth recordings/zeroth --limit 60
python -m app.eval run recordings/zeroth/manifest.csv
```

In the report, `caught_vs_native` is the share of broken syllables that were flagged although the same recording with the correct text did not flag that syllable.

## Tests

```sh
pip install -r requirements.txt -r requirements-dev.txt
python -m nltk.downloader cmudict
pytest && ruff check . && ruff format --check .
```

The tests don't need torch: the model is replaced by a fake (`tests/fake.py`).
