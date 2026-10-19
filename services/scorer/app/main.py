"""Pronunciation scorer (docs/PLAN.md §4.3).

Internal service: listens on 127.0.0.1 only and is called by the API after auth
and rate limits. The model pipeline lands in stage 4 once stage 0 validates it.
"""

from fastapi import FastAPI, HTTPException

app = FastAPI(title="kquiz-scorer", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/score")
def score() -> None:
    raise HTTPException(status_code=501, detail="scoring is not implemented yet")
