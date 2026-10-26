import { useCallback, useEffect, useRef, useState } from "react";
import { playOnce } from "../lib/audioSession";
import { play, practice, preload, stopPlayback, textAudioUrl, useIntonation, type ShadowItem } from "../lib/practice";
import { canRecord, Recorder, RecorderFailure, type RecorderError } from "../lib/recorder";
import { navigate } from "../lib/router";
import { IntonationChart } from "../ui/IntonationChart";
import { CloseIcon, PlayIcon, RetryIcon, SpeakerIcon } from "../ui/icons";
import { HeadphonesIcon } from "../ui/practiceIcons";
import { RecordButton } from "./Speech";
import "../ui/practice.css";

type Phase = "prompt" | "recording" | "scoring" | "result";

const MIC_ERRORS: Record<RecorderError, string> = {
  unsupported: "Этот браузер не умеет записывать звук. Открой приложение в Safari на iPhone.",
  denied: "Нет доступа к микрофону. Разреши его в Настройках → Safari → Микрофон и попробуй снова.",
  no_microphone: "Не нашёлся микрофон.",
  failed: "Не получилось включить микрофон. Попробуй ещё раз.",
};

// Speaking over the reference is real shadowing, but without headphones the reference leaks into
// the take and the curve compares it with itself; so it is opt-in and remembered.
const TOGETHER_KEY = "kquiz.shadow.together";

function readTogether(): boolean {
  try {
    return localStorage.getItem(TOGETHER_KEY) === "1";
  } catch {
    return false;
  }
}

/** Example sentences from the cards: listen, say it the same way, see where the melody parts. */
export function ShadowingScreen() {
  const [items, setItems] = useState<ShadowItem[]>();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("prompt");
  const [take, setTake] = useState<{ wav: Uint8Array<ArrayBuffer>; url: string }>();
  const [together, setTogether] = useState(readTogether);
  const [error, setError] = useState<string>();
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<Recorder>(undefined);
  const startedAt = useRef(0);

  const item = items?.[index];
  const refUrl = item ? textAudioUrl(item.ko) : "";
  const intonation = useIntonation(refUrl, take?.wav);

  useEffect(() => {
    document.title = "Шедоуинг · KQuiz";
    practice.shadowing(10).then(
      ({ items }) => setItems(items),
      (e: Error) => setError(e.message),
    );
    return () => {
      recorder.current?.close();
      stopPlayback();
    };
  }, []);

  useEffect(() => () => void (take && URL.revokeObjectURL(take.url)), [take]);

  useEffect(() => {
    if (item) preload(textAudioUrl(item.ko));
    const next = items?.[index + 1];
    if (next) preload(textAudioUrl(next.ko));
  }, [item, items, index]);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setSeconds((performance.now() - startedAt.current) / 1000), 200);
    return () => clearInterval(id);
  }, [phase]);

  const listen = useCallback(() => {
    if (!item) return;
    void play(textAudioUrl(item.ko)).then((ok) => {
      if (!ok) setError("Образец ещё не готов. Сервер озвучивает примеры в фоне, загляни позже.");
    });
  }, [item]);

  const stop = useCallback(async () => {
    const r = recorder.current;
    if (!r?.recording) return;
    setPhase("scoring");
    setLevel(0);
    stopPlayback();
    const recorded = await r.stop();
    if (!recorded || recorded.seconds < 0.5) {
      setPhase(take ? "result" : "prompt");
      setError("Запись получилась слишком короткой. Скажи фразу целиком.");
      return;
    }
    setTake({ wav: recorded.wav, url: URL.createObjectURL(new Blob([recorded.wav], { type: "audio/wav" })) });
    setPhase("result");
  }, [take]);

  const record = useCallback(async () => {
    if (!item) return;
    if (phase === "recording") return void stop();
    if (phase === "scoring") return;
    setError(undefined);
    // Started inside the tap, before any await, or iOS refuses to play it.
    if (together) listen();
    else stopPlayback();
    recorder.current ??= new Recorder();
    try {
      await recorder.current.start(
        (rms) => setLevel(Math.min(1, rms * 6)),
        () => void stop(),
      );
    } catch (e) {
      stopPlayback();
      setError(MIC_ERRORS[e instanceof RecorderFailure ? e.reason : "failed"]);
      return;
    }
    startedAt.current = performance.now();
    setSeconds(0);
    setPhase("recording");
  }, [item, phase, stop, together, listen]);

  const next = useCallback(() => {
    stopPlayback();
    setIndex((i) => i + 1);
    setPhase("prompt");
    setTake(undefined);
    setError(undefined);
  }, []);

  const toggleTogether = () => {
    setTogether((on) => {
      try {
        localStorage.setItem(TOGETHER_KEY, on ? "0" : "1");
      } catch {
        // Not remembered, still works for this visit.
      }
      return !on;
    });
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") navigate("today");
      else if (e.key === " " && !e.repeat) {
        e.preventDefault();
        void record();
      } else if (e.key === "Enter" && phase === "result") next();
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [record, next, phase]);

  const total = items?.length ?? 0;
  const progress = total ? Math.min(index / total, 1) : 0;

  return (
    <main className="review speech shadow">
      <header className="review-top">
        <a className="icon-button" href="#/" aria-label="Закончить">
          <CloseIcon />
        </a>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index}>
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="review-count">
          {Math.min(index, total)} / {total}
        </span>
      </header>

      {!items && !error && <div className="review-stage" aria-busy="true" />}

      {items && !item && <ShadowingDone count={index} />}

      {item && (
        <>
          <div className="review-stage">
            <div className="review-card speech-card" key={index}>
              <div className="speech-body">
                <p className="speech-ask">Повтори за образцом</p>
                <p className="shadow-sentence" lang="ko">
                  {item.ko}
                </p>
                <p className="shadow-translation">{item.ru}</p>
                <p className="shadow-word">
                  <span lang="ko">{item.word}</span>
                  <span className="muted">{item.meaning}</span>
                </p>
                {phase === "result" && <IntonationChart state={intonation} />}
              </div>

              <button type="button" className="icon-button speak-button" aria-label="Послушать образец" onClick={listen}>
                <SpeakerIcon />
              </button>
            </div>
          </div>

          <div aria-live="polite">{error && <p className="notice notice-error speech-notice">{error}</p>}</div>

          <footer className="review-actions">
            {phase === "result" ? (
              <>
                <div className="speech-again">
                  <button type="button" className="chip-button" onClick={listen}>
                    <SpeakerIcon />
                    Образец
                  </button>
                  {take && (
                    <button type="button" className="chip-button" onClick={() => playOnce(take.url)}>
                      <PlayIcon />
                      Моя запись
                    </button>
                  )}
                  <button type="button" className="chip-button" onClick={() => void record()}>
                    <RetryIcon />
                    Заново
                  </button>
                </div>
                <button type="button" className="button primary" onClick={next}>
                  {index + 1 < total ? "Дальше" : "Готово"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="shadow-together"
                  aria-pressed={together}
                  onClick={toggleTogether}
                  disabled={phase !== "prompt"}
                >
                  <HeadphonesIcon />
                  {together ? "Говорю вместе с образцом" : "Говорить вместе с образцом"}
                  <span className="shadow-switch" aria-hidden="true" />
                </button>
                <RecordButton
                  phase={phase}
                  level={level}
                  seconds={seconds}
                  disabled={!canRecord()}
                  onPress={() => void record()}
                  idleCaption={together ? "В наушниках: нажми и говори вместе с ним" : "Послушай и нажми, чтобы повторить"}
                  busyCaption="Сравниваю…"
                />
              </>
            )}
          </footer>
        </>
      )}
    </main>
  );
}

function ShadowingDone({ count }: { count: number }) {
  return (
    <div className="review-stage">
      <div className="finished">
        <p className="finished-mark" lang="ko">
          {count ? "잘했어요!" : "아직이에요"}
        </p>
        <p className="finished-text">
          {count
            ? `Повторено фраз: ${count}.`
            : "Пока нечего повторять: сервер ещё озвучивает примеры из карточек. Загляни чуть позже."}
        </p>
        <a className="button primary" href="#/">
          На главную
        </a>
      </div>
    </div>
  );
}
