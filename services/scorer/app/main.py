"""Pronunciation scorer (docs/PLAN.md §4.3).

Internal service: listens on 127.0.0.1 only and is called by the API after auth
and rate limits. Limits here protect the CPU (PLAN.md §7): one job at a time,
a short queue, 1 MB / 10 s per recording, 15 s per job.
"""

from __future__ import annotations

import asyncio
import contextlib
import ctypes
import gc
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool

from . import tts
from .audio import InvalidAudio
from .g2p import InvalidText, reference
from .phones import label

log = logging.getLogger("kquiz.scorer")

MAX_BODY_BYTES = 1_000_000
JOB_TIMEOUT_S = float(os.environ.get("SCORER_TIMEOUT", "15"))
MAX_WAITING = 2
# Speech for one card; the API calls one at a time in the background, so this is generous.
TTS_TIMEOUT_S = float(os.environ.get("TTS_TIMEOUT", "60"))
# The TTS model is dropped after this long without requests, giving its ~500 MB back to the
# scoring model; new cards are rare, so it is loaded again only now and then.
TTS_IDLE_S = float(os.environ.get("TTS_IDLE", "300"))


def _load_scorer():
    from .recognizer import Wav2Vec2Recognizer
    from .scoring import Scorer

    return Scorer(Wav2Vec2Recognizer())


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.job = asyncio.Semaphore(1)
    app.state.waiting = 0
    app.state.tasks = set()
    app.state.tts_job = asyncio.Semaphore(1)
    if not hasattr(app.state, "synth"):
        app.state.synth = None
    app.state.synth_used_at = time.monotonic()
    if not hasattr(app.state, "scorer"):
        app.state.scorer = None
        app.state.model_error = None
        if os.environ.get("SCORER_LOAD_MODEL", "1") == "1":
            try:
                app.state.scorer = await run_in_threadpool(_load_scorer)
            except Exception as exc:  # the service still serves /g2p without a model
                log.exception("model failed to load")
                app.state.model_error = f"{type(exc).__name__}: {exc}"
    unloader = asyncio.create_task(_unload_idle_synth(app.state))
    yield
    unloader.cancel()


app = FastAPI(title="kquiz-scorer", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/health")
def health(request: Request) -> dict:
    return {"ok": True, "model": request.app.state.scorer is not None}


def _synth(state):
    # Loaded on the first request, not at startup: it downloads ~400 MB once and costs ~500 MB RAM.
    if state.synth is None:
        threads = int(os.environ.get("SCORER_THREADS", "0")) or None
        state.synth = tts.SupertonicSynthesizer(threads)
    return state.synth


def unload_idle_synth(state, now: float) -> bool:
    """Drops the TTS model if nothing used it for TTS_IDLE_S. Runs on the event loop, between jobs."""
    if state.synth is None or state.tts_job.locked() or now - state.synth_used_at < TTS_IDLE_S:
        return False
    state.synth = None
    gc.collect()
    # glibc keeps freed memory in the process otherwise: without this only ~35 of ~430 MB return.
    with contextlib.suppress(OSError, AttributeError):
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    log.info("tts model unloaded after %.0f s idle", now - state.synth_used_at)
    return True


async def _unload_idle_synth(state) -> None:
    while True:
        await asyncio.sleep(60)
        unload_idle_synth(state, time.monotonic())


@app.post("/tts")
async def speak(request: Request, text: str = Query(min_length=1, max_length=tts.MAX_TEXT)) -> Response:
    """Reference audio for a card as MP3. Called by the API's background worker only."""
    text = text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="text is empty")
    state = request.app.state
    if state.tts_job.locked():
        raise HTTPException(status_code=503, detail="tts is busy", headers={"Retry-After": "5"})

    async def job() -> bytes:
        async with state.tts_job:
            try:
                return await run_in_threadpool(lambda: tts.speak(_synth(state), text))
            finally:
                state.synth_used_at = time.monotonic()

    task = asyncio.create_task(job())
    state.tasks.add(task)

    def done(t: asyncio.Task) -> None:
        state.tasks.discard(t)
        if not t.cancelled():
            t.exception()

    task.add_done_callback(done)
    try:
        mp3 = await asyncio.wait_for(asyncio.shield(task), TTS_TIMEOUT_S)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="tts timed out") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("tts failed")
        raise HTTPException(status_code=503, detail=f"tts failed: {type(exc).__name__}") from exc
    return Response(mp3, media_type="audio/mpeg")


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
