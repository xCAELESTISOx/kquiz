import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { api, holdReview, releaseHeldReview, takeBackReview } from "../lib/api";
import { clozeFor } from "../lib/cloze";
import { useLeechIds } from "../lib/leeches";
import { navigate } from "../lib/router";
import { canRecord, type Recorder } from "../lib/recorder";
import { canSpeak, preloadSpeech, speak } from "../lib/speech";
import type { Card, GroupFilter, QueueItem, QueueMode, RatingName } from "../lib/types";
import { CloseIcon, SpeakerIcon, UndoIcon } from "../ui/icons";
import { LeechBadge } from "../ui/LeechBadge";
import { useGlide } from "../ui/motion";
import { SpeechCard } from "./Speech";

const RATINGS: { name: RatingName; label: string; key: string }[] = [
  { name: "again", label: "Снова", key: "1" },
  { name: "hard", label: "Трудно", key: "2" },
  { name: "good", label: "Хорошо", key: "3" },
  { name: "easy", label: "Легко", key: "4" },
];

const SWIPE_THRESHOLD = 90;

type Swipe = RatingName | "back";

/**
 * Meaning: the Hangul is shown, recall the translation. Listening: only the card's recording plays,
 * the text appears with the answer. Each mode has its own schedule on the server. With a group, the
 * cards picked on the cards screen come instead of the day's queue, and are graded the same way.
 * Mixed puts every mode in one session, saying aloud included: each card is shown and graded in its
 * item's own mode.
 */
export function ReviewScreen({ mode, group }: { mode: Extract<QueueMode, "meaning" | "listening" | "mixed">; group?: GroupFilter }) {
  const [queue, setQueue] = useState<QueueItem[]>();
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  // The card just graded, drawn once more on its way out. Purely decorative: the next card is live at once.
  const [exit, setExit] = useState<{ step: number; rating: RatingName; card: Card }>();
  // The last rating and the session as it was before it, for going back to that card.
  const [last, setLast] = useState<{ reviewId: string; queue: QueueItem[]; done: number }>();
  const shownAt = useRef(performance.now());
  // Mixed sessions say some cards aloud; the microphone is asked for once per session.
  const recorder = useRef<Recorder>(undefined);

  useEffect(() => {
    document.title = mode === "mixed" ? "Вперемешку · KQuiz" : mode === "listening" ? "На слух · KQuiz" : "Повторение · KQuiz";
    (group ? api.group(mode, group) : api.queue(mode, mode === "mixed" ? 200 : undefined)).then(
      ({ items: all }) => {
        // Where nothing can record, saying aloud waits for a device that can.
        const items = canRecord() ? all : all.filter((i) => i.mode !== "speech");
        setQueue(items);
        setTotal(items.length);
        shownAt.current = performance.now();
        // The tap that opened the screen may still count; if not, the big button is right there.
        if (items[0]?.mode === "listening") speak(items[0].card);
      },
      (e: Error) => setError(e.message),
    );
    // A new group is a new screen (App keys it), so `group` never changes here.
  }, [mode]);

  const item = queue?.[0];
  const card = item?.card;
  const listening = item?.mode === "listening";
  const speaking = item?.mode === "speech";
  // Listening shows no text before the answer, so only meaning reviews ask through an example.
  const cloze = useMemo(() => (item?.mode === "meaning" ? clozeFor(item) : undefined), [item]);
  const leeches = useLeechIds(item?.mode ?? (mode === "listening" ? "listening" : "meaning"));

  // Leaving the screen ends the chance to go back, so the held rating goes out.
  useEffect(() => () => void releaseHeldReview(), []);
  useEffect(() => () => recorder.current?.close(), []);

  // The next few too, so their audio is ready by the time they come up (listening plays the next
  // card straight from the grading tap).
  useEffect(() => {
    if (queue) preloadSpeech(...queue.slice(0, 3).map((i) => i.card));
  }, [queue]);

  const reveal = useCallback(() => {
    if (card && !revealed) setRevealed(true);
  }, [card, revealed]);

  const rate = useCallback(
    (rating: RatingName, swiped = false) => {
      if (!item || !card || !revealed || !queue || speaking) return;
      // A swiped card has already flown off under the finger.
      setExit(swiped ? undefined : { step, rating, card });
      const reviewId = crypto.randomUUID();
      void holdReview({
        id: reviewId,
        cardId: card.id,
        mode: item.mode,
        rating,
        reviewedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - shownAt.current),
      }).catch((e: Error) => setError(e.message));
      setLast({ reviewId, queue, done });
      // A forgotten card comes back at the end of this session, like Anki's relearning step.
      const next = queue ? (rating === "again" ? [...queue.slice(1), queue[0]!] : queue.slice(1)) : queue;
      setQueue(next);
      // Inside the tap, where iOS still lets audio play.
      if (next?.[0]?.mode === "listening") speak(next[0].card);
      if (rating !== "again") setDone((n) => n + 1);
      setRevealed(false);
      setStep((n) => n + 1);
      shownAt.current = performance.now();
    },
    [item, card, revealed, step, queue, done, speaking],
  );

  /** A card said aloud has sent its own rating; the session moves on. */
  const spoken = useCallback(
    (rating: RatingName) => {
      if (!queue) return;
      // Going back over it would rate it twice, so the held rating goes out now.
      setLast(undefined);
      void releaseHeldReview();
      setExit(undefined);
      const next = rating === "again" ? [...queue.slice(1), queue[0]!] : queue.slice(1);
      setQueue(next);
      if (next[0]?.mode === "listening") speak(next[0].card);
      if (rating !== "again") setDone((n) => n + 1);
      setRevealed(false);
      setStep((n) => n + 1);
      shownAt.current = performance.now();
    },
    [queue],
  );

  /** Brings the last card back with its answer open, so it can be graded again. */
  const back = useCallback(() => {
    if (!last) return;
    setLast(undefined);
    // Already sent (the screen was left and reopened): that rating stays.
    if (!takeBackReview(last.reviewId)) return;
    setQueue(last.queue);
    setDone(last.done);
    setExit(undefined);
    setRevealed(true);
    setStep((n) => n + 1);
    shownAt.current = performance.now();
  }, [last]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") navigate("today");
      else if (e.key === "Backspace" || e.key === "z" || e.key === "я") back();
      // The card said aloud takes its own keys.
      else if (speaking) return;
      else if (listening && card && (e.key === "r" || e.key === "к")) speak(card);
      else if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        reveal();
      } else if (revealed) {
        const match = RATINGS.find((r) => r.key === e.key);
        if (match) rate(match.name);
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [revealed, reveal, rate, back, listening, speaking, card]);

  const progress = total ? Math.min(done / total, 1) : 0;

  return (
    <main className="review">
      <header className="review-top">
        <a className="icon-button" href="#/" aria-label={mode === "listening" ? "Закончить тренировку на слух" : "Закончить повторение"}>
          <CloseIcon />
        </a>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="review-count">
          {Math.min(done, total)} / {total}
        </span>
        <button
          type="button"
          className="icon-button review-back"
          aria-label="Вернуть предыдущую карточку"
          title="Вернуть предыдущую карточку"
          disabled={!last}
          onClick={back}
        >
          <UndoIcon />
        </button>
      </header>

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      {!queue && !error && <div className="review-stage" aria-busy="true" />}

      {queue && !card && <Finished count={done} />}

      {queue && item && speaking && <SpeechCard key={step} item={item} recorder={recorder} onRated={spoken} />}

      {queue && card && !speaking && (
        <>
          <SwipeCard
            key={step}
            enabled={revealed}
            onTap={reveal}
            onSwipe={(r) => (r === "back" ? back() : rate(r, true))}
            canGoBack={!!last}
            deck={queue.length > 1}
            behind={
              exit && (
                <div
                  key={exit.step}
                  className="review-card card-ghost"
                  data-exit={exit.rating}
                  aria-hidden="true"
                  onAnimationEnd={() => setExit(undefined)}
                >
                  <p className="review-korean" lang="ko">
                    {exit.card.korean}
                  </p>
                  <div className="review-answer">
                    <p className="review-meaning">{exit.card.meaning}</p>
                  </div>
                </div>
              )
            }
          >
            {leeches.has(card.id) && <LeechBadge />}
            {listening && !revealed ? (
              <button
                type="button"
                className="listen-play"
                aria-label="Послушать ещё раз"
                onClick={(e) => {
                  e.stopPropagation();
                  speak(card);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <SpeakerIcon />
              </button>
            ) : cloze ? (
              <GlideText className="review-korean review-sentence" on={revealed}>
                {cloze.before}
                <mark className="cloze-mark">{cloze.word}</mark>
                {cloze.after}
              </GlideText>
            ) : (
              <GlideText className="review-korean" on={revealed}>
                {card.korean}
              </GlideText>
            )}
            {revealed ? (
              <div className="review-answer">
                {cloze && (
                  <p className="review-word" lang="ko">
                    {card.korean}
                  </p>
                )}
                {(card.pronunciation && card.pronunciation !== card.korean) || card.romanization ? (
                  <p className="review-pron">
                    {card.pronunciation && card.pronunciation !== card.korean && (
                      <span lang="ko">[{card.pronunciation}]</span>
                    )}
                    {card.romanization && <span className="muted">{card.romanization}</span>}
                  </p>
                ) : null}
                <p className="review-meaning">{card.meaning}</p>
                {card.examples.length > 0 && (
                  <ul className="review-examples">
                    {card.examples.map((example, i) => (
                      <Example key={i} ko={example.ko} ru={example.ru} />
                    ))}
                  </ul>
                )}
                {card.notes && <p className="review-notes muted">{card.notes}</p>}
              </div>
            ) : (
              <p className="review-hint muted">
                {listening ? "Послушай и вспомни перевод" : cloze ? "Вспомни перевод выделенного слова" : "Вспомни перевод"}
              </p>
            )}
            {canSpeak() && (!listening || revealed) && (
              <button
                type="button"
                className="icon-button speak-button"
                aria-label="Послушать"
                onClick={(e) => {
                  e.stopPropagation();
                  speak(card);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <SpeakerIcon />
              </button>
            )}
          </SwipeCard>

          <footer className="review-actions">
            {revealed ? (
              <div className="ratings is-in">
                {RATINGS.map((r) => (
                  <button key={r.name} type="button" className={`rating rating-${r.name}`} onClick={() => rate(r.name)}>
                    {r.label}
                  </button>
                ))}
              </div>
            ) : (
              <button type="button" className="button primary" onClick={reveal}>
                Показать ответ
              </button>
            )}
            <p className="review-tip muted small">
              {revealed ? "Свайп вправо: «Хорошо», влево: «Снова»" : last && "Свайп вправо: вернуть предыдущую"}
            </p>
          </footer>
        </>
      )}
    </main>
  );
}

/** The translation stays blurred until the sentence is tapped, so the Korean gets read first. */
function Example({ ko, ru }: { ko: string; ru: string }) {
  const [open, setOpen] = useState(false);
  if (!ru) {
    return (
      <li className="review-example">
        <p lang="ko">{ko}</p>
      </li>
    );
  }
  return (
    <li className="review-example">
      <button
        type="button"
        className={`example-toggle${open ? " is-open" : ""}`}
        aria-expanded={open}
        onClick={(e) => {
          // Not a tap on the card itself.
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span lang="ko">{ko}</span>
        <span className="example-ru" aria-hidden={!open}>
          {ru}
        </span>
      </button>
    </li>
  );
}

/** The Hangul glides up to make room for the answer instead of jumping. */
function GlideText({ className, on, children }: { className: string; on: boolean; children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useGlide(ref, on);
  return (
    <p ref={ref} className={className} lang="ko">
      {children}
    </p>
  );
}

function SwipeCard({
  enabled,
  canGoBack,
  onTap,
  onSwipe,
  deck,
  behind,
  children,
}: {
  /** The answer is open, so swiping grades. */
  enabled: boolean;
  /** Before the answer, a swipe to the right brings back the previous card. */
  canGoBack?: boolean;
  onTap: () => void;
  onSwipe: (swipe: Swipe) => void;
  /** More cards wait under this one. */
  deck?: boolean;
  behind?: ReactNode;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<Swipe>();
  const draggable = enabled || !!canGoBack;
  const start = useRef<{ x: number; y: number; id: number }>(undefined);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!draggable || !start.current || start.current.id !== e.pointerId) return;
    // Going back only goes one way; the other just resists.
    const moveX = enabled ? e.clientX - start.current.x : Math.max(e.clientX - start.current.x, 0);
    if (Math.abs(moveX) > 8 && Math.abs(moveX) > Math.abs(e.clientY - start.current.y)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDx(moveX);
    }
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const moved = Math.abs(e.clientX - start.current.x) > 8;
    start.current = undefined;
    if (!moved) {
      setDx(0);
      onTap();
      return;
    }
    if (draggable && Math.abs(dx) >= SWIPE_THRESHOLD) {
      const swipe: Swipe = !enabled ? "back" : dx > 0 ? "good" : "again";
      setLeaving(swipe);
      setTimeout(() => onSwipe(swipe), 180);
    } else {
      setDx(0);
    }
  }

  const strength = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
  const offset = leaving ? (leaving === "again" ? -1 : 1) * 600 : dx;
  const tone: Swipe = leaving ?? (!enabled ? "back" : dx > 0 ? "good" : "again");

  return (
    <div className={`review-stage${deck ? " has-deck" : ""}`}>
      {behind}
      <div
        className={`review-card is-live${dx === 0 && !leaving ? " settle" : ""}${leaving ? " leaving" : ""}`}
        style={{ transform: `translateX(${offset}px) rotate(${offset / 30}deg)` }}
        data-tone={dx !== 0 || leaving ? tone : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = undefined;
          setDx(0);
        }}
      >
        <span className="swipe-badge" style={{ opacity: leaving ? 1 : strength }} aria-hidden="true">
          {tone === "good" ? "Хорошо" : tone === "again" ? "Снова" : "Назад"}
        </span>
        {children}
      </div>
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
          {count ? `Повторено карточек: ${count}. На сегодня всё.` : "Сейчас повторять нечего."}
        </p>
        <a className="button primary" href="#/">
          На главную
        </a>
      </div>
    </div>
  );
}
