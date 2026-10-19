# kquiz-scorer

Внутренний сервис оценки произношения. Слушает только `127.0.0.1`.

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8788
```
