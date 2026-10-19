"""Pronunciation scorer (docs/PLAN.md §4.3).

Internal service: listens on 127.0.0.1 only and is called by the API after auth
and rate limits. Limits here protect the CPU (PLAN.md §7): one job at a time,
a short queue, 1 MB / 10 s per recording, 15 s per job.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool

from .audio import InvalidAudio
from .g2p import InvalidText, reference
from .phones import label

log = logging.getLogger("kquiz.scorer")

MAX_BODY_BYTES = 1_000_000
JOB_TIMEOUT_S = float(os.environ.get("SCORER_TIMEOUT", "15"))
MAX_WAITING = 2


def _load_scorer():
    from .recognizer import Wav2Vec2Recognizer
    from .scoring import Scorer

    return Scorer(Wav2Vec2Recognizer())


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.job = asyncio.Semaphore(1)
    app.state.waiting = 0
    app.state.tasks = set()
    if not hasattr(app.state, "scorer"):
        app.state.scorer = None
        app.state.model_error = None
        if os.environ.get("SCORER_LOAD_MODEL", "1") == "1":
            try:
                app.state.scorer = await run_in_threadpool(_load_scorer)
            except Exception as exc:  # the service still serves /g2p without a model
                log.exception("model failed to load")
                app.state.model_error = f"{type(exc).__name__}: {exc}"
    yield


app = FastAPI(title="kquiz-scorer", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/health")
def health(request: Request) -> dict:
    return {"ok": True, "model": request.app.state.scorer is not None}


@app.get("/g2p")
def g2p(text: str = Query(max_length=200)) -> dict:
    """Pronunciation in Hangul, romanization and phones for card autofill."""
    try:
        ref = reference(text)
    except InvalidText as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "text": ref.text,
        "pronunciation": ref.pronunciation,
        "romanization": ref.romanization,
        "phones": [{"syllable": p.syllable, "position": p.position, **label(p.phone)} for p in ref.phones],
    }


async def _read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="recording is larger than 1 MB")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="recording is larger than 1 MB")
        chunks.append(chunk)
    return b"".join(chunks)


@app.post("/score")
async def score(request: Request, text: str = Query(max_length=200)) -> dict:
    """Body: the recording as WAV (16 kHz mono PCM preferred). Query: the card's Korean text."""
    try:
        reference(text)
    except InvalidText as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    scorer = request.app.state.scorer
    if scorer is None:
        detail = request.app.state.model_error or "model is not loaded"
        raise HTTPException(status_code=503, detail=detail)
    data = await _read_body(request)

    state = request.app.state
    if state.waiting >= MAX_WAITING:
        raise HTTPException(status_code=503, detail="scorer is busy", headers={"Retry-After": "5"})

    async def job():
        async with state.job:
            return await run_in_threadpool(scorer.score_wav, data, text)

    # The job keeps the slot until its thread really finishes, even after a
    # timeout, so a slow recording never lets two jobs share the CPU.
    state.waiting += 1
    task = asyncio.create_task(job())
    state.tasks.add(task)

    def done(t: asyncio.Task) -> None:
        state.waiting -= 1
        state.tasks.discard(t)
        if not t.cancelled():
            t.exception()  # mark a late failure as retrieved

    task.add_done_callback(done)
    try:
        result = await asyncio.wait_for(asyncio.shield(task), JOB_TIMEOUT_S)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="scoring timed out") from exc
    except InvalidAudio as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result.to_dict()
