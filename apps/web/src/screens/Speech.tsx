import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api, ApiError, submitReview } from "../lib/api";
import { clozeFor } from "../lib/cloze";
import { useLeechIds } from "../lib/leeches";
import { describeErrors, segments, verdict } from "../lib/pronunciation";
import { canRecord, MAX_SECONDS, Recorder, RecorderFailure, type RecorderError } from "../lib/recorder";
import { navigate } from "../lib/router";
import { cardAudioUrl, useIntonation } from "../lib/practice";
import { canSpeak, preloadSpeech, speak } from "../lib/speech";
import type { Card, QueueItem, RatingName, ScoreResult } from "../lib/types";
import { LeechBadge } from "../ui/LeechBadge";
import { CloseIcon, MicIcon, PlayIcon, RetryIcon, SpeakerIcon, StopIcon } from "../ui/icons";
import { IntonationChart } from "../ui/IntonationChart";
import { useCountUp } from "../ui/motion";
import { Spinner } from "../ui/Spinner";

const RATINGS: { name: RatingName; label: string; key: string }[] = [
  { name: "again", label: "Снова", key: "1" },
  { name: "hard", label: "Трудно", key: "2" },
  { name: "good", label: "Хорошо", key: "3" },
  { name: "easy", label: "Легко", key: "4" },
];

type Phase = "prompt" | "recording" | "scoring" | "result";

const MIC_ERRORS: Record<RecorderError, string> = {
  unsupported: "Этот браузер не умеет записывать звук. Открой приложение в Safari на iPhone.",
  denied: "Нет доступа к микрофону. Разреши его в Настройках → Safari → Микрофон и попробуй снова.",
  no_microphone: "Не нашёлся микрофон.",
  failed: "Не получилось включить микрофон. Попробуй ещё раз.",
};

function scoreError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Нет связи с сервером. Оцени себя сам или попробуй позже.";
  switch (error.code) {
    case "bad_recording":
      return "Не удалось разобрать запись: слишком тихо или коротко. Скажи слово чуть громче.";
    case "busy":
      return "Проверка занята другой записью. Подожди пару секунд и запиши ещё раз.";
    case "timeout":
    case "unavailable":
      return "Проверка произношения сейчас недоступна. Оцени себя сам.";
    default:
      return error.message;
  }
}

export function SpeechScreen() {
  const [queue, setQueue] = useState<QueueItem[]>();
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>("prompt");
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<ScoreResult>();
  const [scoreFailed, setScoreFailed] = useState<string>();
  const [error, setError] = useState<string>();
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [take, setTake] = useState<string>();
  const [takeWav, setTakeWav] = useState<Uint8Array>();
  const recorder = useRef<Recorder>(undefined);
  const shownAt = useRef(performance.now());
  const startedAt = useRef(0);

  useEffect(() => {
    document.title = "Произношение · KQuiz";
    api.queue("speech").then(
      ({ items }) => {
        setQueue(items);
        setTotal(items.length);
        shownAt.current = performance.now();
      },
      (e: Error) => setError(e.message),
    );
    return () => recorder.current?.close();
  }, []);

  // The take's object URL lives until the next take or the screen closes.
  useEffect(() => () => void (take && URL.revokeObjectURL(take)), [take]);

  // The timer and the live level only matter while recording.
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setSeconds((performance.now() - startedAt.current) / 1000), 200);
    return () => clearInterval(id);
  }, [phase]);

  const item = queue?.[0];
  const card = item?.card;
  const cloze = useMemo(() => item && clozeFor(item), [item]);
  const leeches = useLeechIds("speech");
  const intonation = useIntonation(card ? cardAudioUrl(card.id) : "", takeWav);

  // The next few too, so their audio is ready by the time they come up.
  useEffect(() => {
    if (queue) preloadSpeech(...queue.slice(0, 3).map((i) => i.card));
  }, [queue]);

  const stop = useCallback(async () => {
    const r = recorder.current;
    if (!r?.recording || !card) return;
    setPhase("scoring");
    setLevel(0);
    const recorded = await r.stop();
    if (!recorded || recorded.seconds < 0.3) {
      setPhase(result || scoreFailed ? "result" : "prompt");
      setError("Запись получилась слишком короткой. Нажми и скажи слово целиком.");
      return;
    }
    setTake(URL.createObjectURL(new Blob([recorded.wav], { type: "audio/wav" })));
    setTakeWav(recorded.wav);
    try {
      setResult(await api.score(card.id, recorded.wav));
      setScoreFailed(undefined);
    } catch (e) {
      setResult(undefined);
      setScoreFailed(scoreError(e));
    }
    setRevealed(true);
    setPhase("result");
  }, [card, result, scoreFailed]);

  const record = useCallback(async () => {
    if (!card) return;
    if (phase === "recording") return void stop();
    if (phase === "scoring") return;
    setError(undefined);
    recorder.current ??= new Recorder();
    try {
      await recorder.current.start(
        (rms) => setLevel(Math.min(1, rms * 6)),
        () => void stop(),
      );
    } catch (e) {
      setError(MIC_ERRORS[e instanceof RecorderFailure ? e.reason : "failed"]);
      return;
    }
    startedAt.current = performance.now();
    setSeconds(0);
    setPhase("recording");
  }, [card, phase, stop]);

  const rate = useCallback(
    (rating: RatingName) => {
      if (!card || phase !== "result") return;
      void submitReview({
        id: crypto.randomUUID(),
        cardId: card.id,
        mode: "speech",
        rating,
        reviewedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - shownAt.current),
      }).catch((e: Error) => setError(e.message));
      setQueue((q) => (q ? (rating === "again" ? [...q.slice(1), q[0]!] : q.slice(1)) : q));
      if (rating !== "again") setDone((n) => n + 1);
      setStep((n) => n + 1);
      setPhase("prompt");
      setRevealed(false);
      setResult(undefined);
      setScoreFailed(undefined);
      setError(undefined);
      setTake(undefined);
      setTakeWav(undefined);
      shownAt.current = performance.now();
    },
    [card, phase],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") navigate("today");
      else if (e.key === " " && !e.repeat) {
        e.preventDefault();
        void record();
      } else if (phase === "result") {
        const match = RATINGS.find((r) => r.key === e.key);
        if (match) rate(match.name);
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [phase, record, rate]);

  const progress = total ? Math.min(done / total, 1) : 0;
  const suggested = result?.suggestedRating;
  const recordable = canRecord();

  return (
    <main className="review speech">
      <header className="review-top">
        <a className="icon-button" href="#/" aria-label="Закончить тренировку">
          <CloseIcon />
        </a>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="review-count">
          {Math.min(done, total)} / {total}
        </span>
      </header>

      {!queue && !error && <div className="review-stage" aria-busy="true" />}

      {queue && !card && <Finished count={done} />}

      {card && (
        <>
          <div className="review-stage">
            <div className="review-card speech-card" key={step}>
              <div className="speech-body">
              {leeches.has(card.id) && <LeechBadge />}
              <p className="speech-ask">
                {cloze ? `Скажи пропущенное слово${card.korean.endsWith("다") ? " в словарной форме" : ""}` : "Скажи по-корейски"}
              </p>
              <p className="speech-meaning">{card.meaning}</p>
              {cloze && (
                <div className="speech-context">
                  <p lang="ko">
                    {cloze.before}
                    {revealed ? <mark className="cloze-mark">{cloze.word}</mark> : <span className="cloze-gap" aria-label="пропуск" />}
                    {cloze.after}
                  </p>
                  <p className="muted">{card.examples[cloze.example]!.ru}</p>
                </div>
              )}

              {revealed ? (
                <div className="speech-word">
                  <p className={`review-korean${result ? " is-scored" : ""}`} lang="ko" aria-label={card.korean}>
                    {result
                      ? segments(card.korean, result.syllables).map((s, i) =>
                          s.status ? (
                            <span key={i} className={`syl syl-${s.status}`} style={{ "--i": i } as CSSProperties}>
                              {s.text}
                            </span>
                          ) : (
                            <span key={i}>{s.text}</span>
                          ),
                        )
                      : card.korean}
                  </p>
                  <Pronunciation card={card} standard={result?.pronunciation} />
                </div>
              ) : (
                <button type="button" className="speech-reveal" onClick={() => setRevealed(true)}>
                  Показать слово
                </button>
              )}

              {phase === "result" && <ResultDetails result={result} failed={scoreFailed} />}
              {phase === "result" && <IntonationChart state={intonation} compact />}
              </div>

              {canSpeak() && (
                <button type="button" className="icon-button speak-button" aria-label="Послушать образец" onClick={() => speak(card)}>
                  <SpeakerIcon />
                </button>
              )}
            </div>
          </div>

          <div aria-live="polite">{error && <p className="notice notice-error speech-notice">{error}</p>}</div>

          <footer className="review-actions">
            {phase === "result" ? (
              <>
                <div className="speech-again">
                  <button type="button" className="chip-button" onClick={() => void record()}>
                    <RetryIcon />
                    Записать ещё раз
                  </button>
                  {take && (
                    <button type="button" className="chip-button" onClick={() => void new Audio(take).play()}>
                      <PlayIcon />
                      Моя запись
                    </button>
                  )}
                </div>
                <div className="ratings is-in">
                  {RATINGS.map((r) => (
                    <button
                      key={r.name}
                      type="button"
                      className={`rating rating-${r.name}`}
                      data-suggested={r.name === suggested || undefined}
                      onClick={() => rate(r.name)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <p className="review-tip muted small">{suggested ? "Подсвечена оценка по записи, решаешь ты" : "Оцени себя сам"}</p>
              </>
            ) : (
              <RecordButton
                phase={phase}
                level={level}
                seconds={seconds}
                disabled={!recordable}
                onPress={() => void record()}
              />
            )}
          </footer>
        </>
      )}
    </main>
  );
}

/** How the word is said (국물 → [궁물]); the scorer's version wins over the card's. */
function Pronunciation({ card, standard }: { card: Card; standard?: string }) {
  const pron = standard ?? card.pronunciation;
  const showPron = pron && pron.replace(/\s/g, "") !== card.korean.replace(/\s/g, "");
  if (!showPron && !card.romanization) return null;
  return (
    <p className="review-pron">
      {showPron && <span lang="ko">[{pron}]</span>}
      {card.romanization && <span className="muted">{card.romanization}</span>}
    </p>
  );
}

function ResultDetails({ result, failed }: { result?: ScoreResult; failed?: string }) {
  if (!result) return <p className="speech-failed">{failed}</p>;
  const v = verdict(result);
  const lines = describeErrors(result);
  return (
    <div className="speech-result">
      <div className="speech-verdict">
        <p className={`speech-verdict-title tone-${v.tone}`}>{v.title}</p>
        <ScoreRing score={result.score} tone={v.tone} />
      </div>
      <p className="speech-verdict-text">{v.text}</p>
      {lines.length > 0 && (
        <ul className="speech-errors">
          {lines.map((line, i) => (
            <li key={i} className={`speech-error is-${line.status}`} style={{ "--i": i } as CSSProperties}>
              <span className={`syl-chip syl-${line.status}`} lang="ko">
                {line.syllable}
              </span>
              <span>
                <span className="speech-error-label">{line.status === "weak" ? `${line.label}, на грани` : line.label}</span>
                <span className="speech-error-detail">{line.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The score fills its ring while the number counts up, so the result lands as one moment. */
function ScoreRing({ score, tone }: { score: number; tone: string }) {
  const shown = useCountUp(score);
  return (
    <p className={`speech-score tone-${tone}`} aria-label={`Балл ${score} из 100`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="score-track" cx="24" cy="24" r="20" pathLength={100} />
        <circle
          className="score-fill"
          cx="24"
          cy="24"
          r="20"
          pathLength={100}
          style={{ "--score": score } as CSSProperties}
        />
      </svg>
      <span aria-hidden="true">{shown}</span>
    </p>
  );
}

export function RecordButton({
  phase,
  level,
  seconds,
  disabled,
  onPress,
  idleCaption = "Нажми и скажи слово",
  busyCaption = "Слушаю…",
}: {
  phase: Phase;
  level: number;
  seconds: number;
  disabled: boolean;
  onPress: () => void;
  idleCaption?: string;
  busyCaption?: string;
}) {
  const recording = phase === "recording";
  const scoring = phase === "scoring";
  const left = Math.max(0, MAX_SECONDS - seconds);
  return (
    <div className="record">
      <button
        type="button"
        className={`record-button${recording ? " is-recording" : ""}`}
        aria-label={recording ? "Остановить запись" : "Записать"}
        aria-pressed={recording}
        disabled={disabled || scoring}
        onClick={onPress}
      >
        {recording && (
          <>
            <span className="record-ripple" aria-hidden="true" />
            <span className="record-ripple record-ripple-late" aria-hidden="true" />
            <svg className="record-timer" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="48" pathLength={1} style={{ animationDuration: `${MAX_SECONDS}s` }} />
            </svg>
          </>
        )}
        <span className="record-level" style={{ transform: `scale(${1 + level * 0.3})` }} aria-hidden="true" />
        {scoring ? <Spinner /> : recording ? <StopIcon /> : <MicIcon />}
      </button>
      <p className="record-caption" aria-live="polite">
        {disabled
          ? "Запись здесь недоступна"
          : scoring
            ? busyCaption
            : recording
              ? `Говори. Нажми, когда закончишь · ${Math.ceil(left)} с`
              : idleCaption}
      </p>
    </div>
  );
}

function Finished({ count }: { count: number }) {
  return (
    <div className="review-stage">
      <div className="finished">
        <p className="finished-mark" lang="ko">
          잘했어요!
        </p>
        <p className="finished-text">
          {count ? `Проговорено слов: ${count}. На сегодня всё.` : "Сейчас тренировать нечего."}
        </p>
        <a className="button primary" href="#/">
          На главную
        </a>
      </div>
    </div>
  );
}
