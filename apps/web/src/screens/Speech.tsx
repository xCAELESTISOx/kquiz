import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { api, ApiError, submitReview } from "../lib/api";
import { playOnce } from "../lib/audioSession";
import { clozeFor } from "../lib/cloze";
import { useLeechIds } from "../lib/leeches";
import { describeErrors, segments, verdict } from "../lib/pronunciation";
import { canRecord, MAX_SECONDS, Recorder, RecorderFailure, type RecorderError } from "../lib/recorder";
import { wordsWord } from "../lib/plural";
import { groupHash, navigate } from "../lib/router";
import { cardAudioUrl, useIntonation } from "../lib/practice";
import { canSpeak, preloadSpeech, speak } from "../lib/speech";
import type { Card, GroupFilter, QueueItem, RatingName, ScoreResult } from "../lib/types";
import { HiddenTranslation } from "../ui/HiddenTranslation";
import { LeechBadge } from "../ui/LeechBadge";
import { CloseIcon, MicIcon, PlayIcon, RetryIcon, SpeakerIcon, StopIcon } from "../ui/icons";
import { IntonationChart } from "../ui/IntonationChart";
import { useCountUp } from "../ui/motion";
import { useFamily, WordFamily } from "../ui/WordFamily";

const RATINGS: { name: RatingName; label: string; key: string }[] = [
  { name: "again", label: "Again", key: "1" },
  { name: "hard", label: "Hard", key: "2" },
  { name: "good", label: "Good", key: "3" },
  { name: "easy", label: "Easy", key: "4" },
];

type Phase = "prompt" | "recording" | "scoring" | "result";

const MIC_ERRORS: Record<RecorderError, string> = {
  unsupported: "This browser can't record audio. Try an up-to-date Chrome, Safari, Firefox or Edge.",
  denied: "No access to the microphone. Allow it in your browser or system settings and try again.",
  no_microphone: "No microphone found.",
  failed: "Couldn't turn on the microphone. Try again.",
};

function scoreError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Can't reach the server. Grade yourself or try later.";
  switch (error.code) {
    case "bad_recording":
      return "Couldn't make out the recording: too quiet or too short. Say the word a bit louder.";
    case "busy":
      return "The checker is busy with another recording. Wait a few seconds and record again.";
    case "timeout":
    case "unavailable":
      return "Pronunciation check is unavailable right now. Grade yourself.";
    default:
      return error.message;
  }
}

/** With a group, the cards picked on the cards screen come instead of the day's queue. */
export function SpeechScreen({ group }: { group?: GroupFilter }) {
  const [queue, setQueue] = useState<QueueItem[]>();
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  const recorder = useRef<Recorder>(undefined);

  useEffect(() => {
    document.title = "Pronunciation · KQuiz";
    (group ? api.group("speech", group) : api.queue("speech")).then(
      ({ items }) => {
        setQueue(items);
        setTotal(items.length);
      },
      (e: Error) => setError(e.message),
    );
    return () => recorder.current?.close();
  }, []);

  const item = queue?.[0];

  // The next few too, so their audio is ready by the time they come up.
  useEffect(() => {
    if (queue) preloadSpeech(...queue.slice(0, 3).map((i) => i.card));
  }, [queue]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") navigate("today");
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const rated = useCallback((rating: RatingName) => {
    setQueue((q) => (q ? (rating === "again" ? [...q.slice(1), q[0]!] : q.slice(1)) : q));
    if (rating !== "again") setDone((n) => n + 1);
    setStep((n) => n + 1);
  }, []);

  const progress = total ? Math.min(done / total, 1) : 0;

  return (
    <main className="review speech">
      <header className="review-top">
        <a className="icon-button" href="#/" aria-label="End practice">
          <CloseIcon />
        </a>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="review-count">
          {Math.min(done, total)} / {total}
        </span>
      </header>

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      {!queue && !error && <div className="review-stage" aria-busy="true" />}

      {queue && !item && <Finished count={done} />}

      {item && (
        <SpeechCard
          key={step}
          item={item}
          recorder={recorder}
          onRated={rated}
          quiet={<a href={group ? groupHash("choose", group) : "#/choose"}>Choose from options</a>}
        />
      )}
    </main>
  );
}

/**
 * One card said aloud: record, see the scorer's verdict, grade it. Sends its own rating to the speech
 * schedule, then tells the session. A fresh one (keyed) per showing; the microphone is the session's,
 * so it is asked for once. `quiet` offers the way through without speaking (picking from options).
 */
export function SpeechCard({
  item,
  recorder,
  onRated,
  quiet,
  practice,
  onCantSpeak,
}: {
  item: QueueItem;
  recorder: RefObject<Recorder | undefined>;
  onRated: (rating: RatingName) => void;
  quiet?: ReactNode;
  /** Learning one word: neither the rating nor the take is kept. */
  practice?: boolean;
  /** "Can't speak now": the word is passed over without saying it. */
  onCantSpeak?: () => void;
}) {
  const { card } = item;
  const [phase, setPhase] = useState<Phase>("prompt");
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<ScoreResult>();
  const [scoreFailed, setScoreFailed] = useState<string>();
  const [error, setError] = useState<string>();
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [take, setTake] = useState<string>();
  const [takeWav, setTakeWav] = useState<Uint8Array>();
  // "Don't know": the word is shown and the card counts as forgotten.
  const [skipped, setSkipped] = useState(false);
  const shownAt = useRef(performance.now());
  const startedAt = useRef(0);

  // The take's object URL lives until the next take or the card goes.
  useEffect(() => () => void (take && URL.revokeObjectURL(take)), [take]);

  // The timer and the live level only matter while recording.
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setSeconds((performance.now() - startedAt.current) / 1000), 200);
    return () => clearInterval(id);
  }, [phase]);

  // Graded or left mid-take: the recording stops with the card.
  useEffect(() => () => void (recorder.current?.recording && recorder.current.stop()), [recorder]);

  const cloze = useMemo(() => clozeFor(item), [item]);
  const families = useFamily(card);
  const leeches = useLeechIds("speech");
  const intonation = useIntonation(cardAudioUrl(card.id), takeWav);

  const stop = useCallback(async () => {
    const r = recorder.current;
    if (!r?.recording) return;
    setPhase("scoring");
    setLevel(0);
    const recorded = await r.stop();
    if (!recorded || recorded.seconds < 0.3) {
      setPhase(result || scoreFailed ? "result" : "prompt");
      setError("The recording is too short. Tap and say the whole word.");
      return;
    }
    setTake(URL.createObjectURL(new Blob([recorded.wav], { type: "audio/wav" })));
    setTakeWav(recorded.wav);
    try {
      setResult(await api.score(card.id, recorded.wav, practice));
      setScoreFailed(undefined);
    } catch (e) {
      setResult(undefined);
      setScoreFailed(scoreError(e));
    }
    setRevealed(true);
    setPhase("result");
  }, [card, recorder, result, scoreFailed, practice]);

  const record = useCallback(async () => {
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
  }, [phase, recorder, stop]);

  const rate = useCallback(
    (rating: RatingName) => {
      if (phase !== "result") return;
      if (!practice)
        void submitReview({
          id: crypto.randomUUID(),
          cardId: card.id,
          mode: "speech",
          rating,
          reviewedAt: new Date().toISOString(),
          elapsedMs: Math.round(performance.now() - shownAt.current),
        }).catch(() => undefined);
      onRated(rating);
    },
    [card, phase, onRated, practice],
  );

  const skip = useCallback(() => {
    setSkipped(true);
    setRevealed(true);
    if (canSpeak()) speak(card);
  }, [card]);

  const skipNext = useCallback(() => {
    if (!practice)
      void submitReview({
        id: crypto.randomUUID(),
        cardId: card.id,
        mode: "speech",
        rating: "again",
        reviewedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - shownAt.current),
      }).catch(() => undefined);
    onRated("again");
  }, [card, onRated, practice]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (skipped) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          skipNext();
        }
      } else if (e.key === " " && !e.repeat) {
        e.preventDefault();
        void record();
      } else if (phase === "result") {
        const match = RATINGS.find((r) => r.key === e.key);
        if (match) rate(match.name);
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [phase, record, rate, skipped, skipNext]);

  const suggested = result?.suggestedRating;
  const recordable = canRecord();

  return (
    <>
      <div className="review-stage">
        <div className="review-card speech-card">
          <div className="speech-body">
          {leeches.has(card.id) && <LeechBadge />}
          <p className="speech-ask">
            {cloze ? `Say the missing word${card.korean.endsWith("다") ? " in dictionary form" : ""}` : "Say it in Korean"}
          </p>
          <p className="speech-meaning">{card.meaning}</p>
          {cloze && (
            <div className="speech-context">
              <p lang="ko">
                {cloze.before}
                {revealed ? <mark className="cloze-mark">{cloze.word}</mark> : <span className="cloze-gap" aria-label="gap" />}
                {cloze.after}
              </p>
              <HiddenTranslation text={card.examples[cloze.example]!.ru} />
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
              Show word
            </button>
          )}

          {phase === "result" && <ResultDetails result={result} failed={scoreFailed} />}
          {phase === "result" && <IntonationChart state={intonation} compact />}
          {phase === "result" && <WordFamily card={card} families={families} />}
          </div>

          {canSpeak() && (
            <button type="button" className="icon-button speak-button" aria-label="Play the sample" onClick={() => speak(card)}>
              <SpeakerIcon />
            </button>
          )}
        </div>
      </div>

      <div aria-live="polite">{error && <p className="notice notice-error speech-notice">{error}</p>}</div>

      <footer className="review-actions">
        {skipped ? (
          <>
            <button type="button" className="button primary" onClick={skipNext}>
              Next
            </button>
            <p className="review-tip muted small">Counted as “Again”: the word comes back at the end</p>
          </>
        ) : phase === "result" ? (
          <>
            <div className="speech-again">
              <button type="button" className="chip-button" onClick={() => void record()}>
                <RetryIcon />
                Record again
              </button>
              {take && (
                <button type="button" className="chip-button" onClick={() => playOnce(take)}>
                  <PlayIcon />
                  My recording
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
            <p className="review-tip muted small">{suggested ? "The grade from your recording is highlighted, you decide" : "Grade yourself"}</p>
          </>
        ) : (
          <>
            <RecordButton
              phase={phase}
              level={level}
              seconds={seconds}
              disabled={!recordable}
              onPress={() => void record()}
            />
            {phase === "prompt" && (
              <div className="speech-skips">
                <button type="button" className="chip-button dont-know" onClick={skip}>
                  Don't know
                </button>
                {onCantSpeak && (
                  <button type="button" className="chip-button dont-know" onClick={onCantSpeak}>
                    Can't speak now
                  </button>
                )}
              </div>
            )}
            {quiet && phase === "prompt" && <p className="review-tip muted small">Can't speak? {quiet}</p>}
          </>
        )}
      </footer>
    </>
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
                <span className="speech-error-label">{line.status === "weak" ? `${line.label}, borderline` : line.label}</span>
                <span className="speech-error-detail">{line.detail}</span>
                {line.fix && <span className="speech-error-fix">{line.fix}</span>}
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
    <p className={`speech-score tone-${tone}`} aria-label={`Score ${score} of 100`}>
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
  idleCaption = "Tap and say the word",
  busyCaption = "Checking your pronunciation",
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
  const slow = useSlow(scoring, 4000);
  return (
    <div className="record">
      <button
        type="button"
        className={`record-button${recording ? " is-recording" : ""}${scoring ? " is-scoring" : ""}`}
        aria-label={recording ? "Stop recording" : scoring ? "Checking" : "Record"}
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
        {scoring && <span className="record-orbit" aria-hidden="true" />}
        {scoring ? <ScoringBars /> : recording ? <StopIcon /> : <MicIcon />}
      </button>
      <p className="record-caption" aria-live="polite">
        {disabled
          ? "Recording isn't available here"
          : scoring
            ? (
                <span className="record-busy">
                  {slow ? "Almost there" : busyCaption}
                  <span className="record-dots" aria-hidden="true">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                </span>
              )
            : recording
              ? `Speak. Tap when you're done · ${Math.ceil(left)} s`
              : idleCaption}
      </p>
    </div>
  );
}

/** The take being analysed: bars that ripple like a voice level, inside the button. */
function ScoringBars() {
  return (
    <span className="record-bars" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} style={{ "--i": i } as CSSProperties} />
      ))}
    </span>
  );
}

/** True once `active` has lasted `ms`, so a long wait can say it's nearly done. */
function useSlow(active: boolean, ms: number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!active) return;
    const id = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return slow;
}

function Finished({ count }: { count: number }) {
  return (
    <div className="review-stage">
      <div className="finished">
        <p className="finished-mark" lang="ko">
          잘했어요!
        </p>
        <p className="finished-text">
          {count ? `You said ${count} ${wordsWord(count)}. That's all for today.` : "Nothing to practise right now."}
        </p>
        <a className="button primary" href="#/">
          Home
        </a>
      </div>
    </div>
  );
}
