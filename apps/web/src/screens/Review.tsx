import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { api, submitReview } from "../lib/api";
import { navigate } from "../lib/router";
import { canSpeak, preloadSpeech, speak } from "../lib/speech";
import type { Card, RatingName, ReviewMode } from "../lib/types";
import { CloseIcon, SpeakerIcon } from "../ui/icons";
import { useGlide } from "../ui/motion";

const RATINGS: { name: RatingName; label: string; key: string }[] = [
  { name: "again", label: "Снова", key: "1" },
  { name: "hard", label: "Трудно", key: "2" },
  { name: "good", label: "Хорошо", key: "3" },
  { name: "easy", label: "Легко", key: "4" },
];

const SWIPE_THRESHOLD = 90;

/**
 * Meaning: the Hangul is shown, recall the translation. Listening: only the card's recording plays,
 * the text appears with the answer. Each mode has its own schedule on the server.
 */
export function ReviewScreen({ mode }: { mode: Extract<ReviewMode, "meaning" | "listening"> }) {
  const listening = mode === "listening";
  const [queue, setQueue] = useState<Card[]>();
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  // The card just graded, drawn once more on its way out. Purely decorative: the next card is live at once.
  const [exit, setExit] = useState<{ step: number; rating: RatingName; card: Card }>();
  const shownAt = useRef(performance.now());

  useEffect(() => {
    document.title = listening ? "На слух · KQuiz" : "Повторение · KQuiz";
    api.queue(mode).then(
      ({ items }) => {
        setQueue(items.map((item) => item.card));
        setTotal(items.length);
        shownAt.current = performance.now();
        // The tap that opened the screen may still count; if not, the big button is right there.
        if (listening && items[0]) speak(items[0].card);
      },
      (e: Error) => setError(e.message),
    );
  }, [mode, listening]);

  const card = queue?.[0];
  const upcoming = queue?.[1];

  useEffect(() => {
    if (card) preloadSpeech(card);
    // Listening plays the next card straight from the grading tap, so it should be loaded by then.
    if (listening && upcoming) preloadSpeech(upcoming);
  }, [card, upcoming, listening]);

  const reveal = useCallback(() => {
    if (card && !revealed) setRevealed(true);
  }, [card, revealed]);

  const rate = useCallback(
    (rating: RatingName, swiped = false) => {
      if (!card || !revealed) return;
      // A swiped card has already flown off under the finger.
      setExit(swiped ? undefined : { step, rating, card });
      void submitReview({
        id: crypto.randomUUID(),
        cardId: card.id,
        mode,
        rating,
        reviewedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - shownAt.current),
      }).catch((e: Error) => setError(e.message));
      // A forgotten card comes back at the end of this session, like Anki's relearning step.
      const next = queue ? (rating === "again" ? [...queue.slice(1), queue[0]!] : queue.slice(1)) : queue;
      setQueue(next);
      // Inside the tap, where iOS still lets audio play.
      if (listening && next?.[0]) speak(next[0]);
      if (rating !== "again") setDone((n) => n + 1);
      setRevealed(false);
      setStep((n) => n + 1);
      shownAt.current = performance.now();
    },
    [card, revealed, step, queue, mode, listening],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") navigate("today");
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
  }, [revealed, reveal, rate, listening, card]);

  const progress = total ? Math.min(done / total, 1) : 0;

  return (
    <main className="review">
      <header className="review-top">
        <a className="icon-button" href="#/" aria-label={listening ? "Закончить тренировку на слух" : "Закончить повторение"}>
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

      {queue && !card && <Finished count={done} />}

      {card && (
        <>
          <SwipeCard
            key={step}
            enabled={revealed}
            onTap={reveal}
            onSwipe={(r) => rate(r, true)}
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
            ) : (
              <GlideText className="review-korean" on={revealed}>
                {card.korean}
              </GlideText>
            )}
            {revealed ? (
              <div className="review-answer">
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
                      <li key={i} className="review-example">
                        <p lang="ko">{example.ko}</p>
                        {example.ru && <p className="muted">{example.ru}</p>}
                      </li>
                    ))}
                  </ul>
                )}
                {card.notes && <p className="review-notes muted">{card.notes}</p>}
              </div>
            ) : (
              <p className="review-hint muted">{listening ? "Послушай и вспомни перевод" : "Вспомни перевод"}</p>
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
            <p className="review-tip muted small">{revealed && "Свайп вправо: «Хорошо», влево: «Снова»"}</p>
          </footer>
        </>
      )}
    </main>
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
  onTap,
  onSwipe,
  deck,
  behind,
  children,
}: {
  enabled: boolean;
  onTap: () => void;
  onSwipe: (rating: RatingName) => void;
  /** More cards wait under this one. */
  deck?: boolean;
  behind?: ReactNode;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<RatingName>();
  const start = useRef<{ x: number; y: number; id: number }>(undefined);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!enabled || !start.current || start.current.id !== e.pointerId) return;
    const moveX = e.clientX - start.current.x;
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
    if (enabled && Math.abs(dx) >= SWIPE_THRESHOLD) {
      const rating: RatingName = dx > 0 ? "good" : "again";
      setLeaving(rating);
      setTimeout(() => onSwipe(rating), 180);
    } else {
      setDx(0);
    }
  }

  const strength = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
  const offset = leaving ? (leaving === "good" ? 1 : -1) * 600 : dx;
  const tone = dx > 0 || leaving === "good" ? "good" : "again";

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
          {tone === "good" ? "Хорошо" : "Снова"}
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
