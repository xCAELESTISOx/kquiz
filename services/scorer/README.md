# kquiz-scorer

Внутренний сервис оценки произношения (docs/PLAN.md §4.3). Слушает только `127.0.0.1`, к нему ходит `apps/api` после авторизации и лимитов.

## Запуск

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m nltk.downloader cmudict          # g2pkiwi читает словарь при импорте
# модель (на сервере без GPU — torch с CPU-индекса):
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-ml.txt
uvicorn app.main:app --host 127.0.0.1 --port 8788
```

Переменные: `SCORER_MODEL` (id на Hugging Face или локальный путь, по умолчанию `slplab/wav2vec2-xls-r-300m_phone-mfa_korean`), `SCORER_THREADS` (потоки torch, 2), `SCORER_TIMEOUT` (секунд на задачу, 15), `SCORER_LOAD_MODEL=0` — не грузить модель (работает только `/g2p`).

## API

| Запрос | Ответ |
|---|---|
| `GET /health` | `{"ok": true, "model": true}` |
| `GET /g2p?text=국물` | `{"text", "pronunciation": "궁물", "romanization": "gungmul", "phones": [{"syllable", "position", "ipa", "jamo"}]}` — для автозаполнения карточки |
| `POST /score?text=국물`, тело — WAV | результат ниже |

Ответ `/score`:

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

`status`: `ok` / `weak` / `wrong`. `kind`: `substitution`, `deletion`, `insertion` (лишний звук, `position: "extra"`), `unclear` (звук тот, но модель не уверена).

Ошибки: `422` — плохой текст или запись (не WAV, тишина, длиннее 10 с), `413` — тело больше 1 МБ, `503` — модель не загружена или уже ждут две задачи, `504` — задача не уложилась в 15 с. Задачи выполняются строго по одной.

Запись: WAV PCM, лучше 16 кГц моно 16 бит (так пишет PWA). Другие частоты и стерео принимаются и приводятся к 16 кГц моно.

## Как считается

1. WAV → 16 кГц моно, обрезка тишины с запасом 200 мс, нормализация громкости.
2. Модель wav2vec2 выдаёт вероятности своих меток по кадрам. Метки сводятся к нашему набору фонем (`app/phones.py`): аллофоны вроде звонкого [ɡ], нераскрытого [k̚] или [ɾ] для ㄹ не считаются ошибкой, ㅐ = ㅔ.
3. Эталон: g2pkiwi даёт произносимую форму (국물 → 궁물), она раскладывается на фонемы по слогам.
4. Услышанное выравнивается с эталоном взвешенным Левенштейном: ㄱ/ㅋ/ㄲ и ㅓ/ㅗ — близкие замены (weak), далёкие — wrong. Потеря скольжения (계 [ke]) и слабого ㅎ стоит дёшево.
5. Принудительное CTC-выравнивание эталона даёт уверенность по каждому звуку; совпавший звук с низкой уверенностью — weak.
6. Балл — среднее по слогам; слог с ошибкой ограничен сверху (weak ≤ 80, wrong ≤ 40), чтобы одна ошибка в коротком слове не давала «good».

Пороги (`app/scoring.py`) подбираются на этапе 0.

## Этап 0: проверка на своих записях

```sh
pip install -r requirements-ml.txt   # плюс torch, см. выше
python -m app.eval vocab             # как метки модели легли на наши фонемы; код 1, если какой-то звук модель не умеет
python -m app.eval one rec.wav 국물  # один файл, полный ответ
python -m app.eval run recordings/manifest.csv --json recordings/report.json
```

Записи кладутся в `services/scorer/recordings/` (папка в `.gitignore`, голос в репозиторий не попадает). `manifest.csv` — как в `eval/manifest.example.csv`:

| Колонка | Что писать |
|---|---|
| `file` | путь от манифеста: `.wav` или `.m4a` из «Диктофона» (для m4a нужен `ffmpeg`) |
| `text` | слово, которое сказано |
| `kind` | `tts` или `native` — эталон, `mine` — сказано как умеешь, `broken` — нарочно испорчено |
| `bad` | для `broken`: номера испорченных слогов с 1, через `;` |

Отчёт показывает: долю эталонов с баллом ≥ 90 (критерий плана), долю испорченных слогов, которые нашлись, сколько слогов помечено в обычных записях и скорость (p50/p95 и отношение ко времени речи).

## Тесты

```sh
pip install -r requirements.txt -r requirements-dev.txt
python -m nltk.downloader cmudict
pytest && ruff check . && ruff format --check .
```

Тесты не требуют torch: модель заменена подставной (`tests/fake.py`).
