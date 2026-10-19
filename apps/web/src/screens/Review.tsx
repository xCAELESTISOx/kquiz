import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { api, submitReview } from "../lib/api";
import { navigate } from "../lib/router";
import { canSpeak, speak } from "../lib/speech";
import type { Card, RatingName } from "../lib/types";
import { CloseIcon, SpeakerIcon } from "../ui/icons";

const RATINGS: { name: RatingName; label: string; key: string }[] = [
  { name: "again", label: "Снова", key: "1" },
  { name: "hard", label: "Трудно", key: "2" },
  { name: "good", label: "Хорошо", key: "3" },
  { name: "easy", label: "Легко", key: "4" },
];

const SWIPE_THRESHOLD = 90;

export function ReviewScreen() {
  const [queue, setQueue] = useState<Card[]>();
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  const shownAt = useRef(performance.now());

  useEffect(() => {
    document.title = "Повторение · KQuiz";
    api.queue("meaning").then(
      ({ cards }) => {
        setQueue(cards);
        setTotal(cards.length);
        shownAt.current = performance.now();
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  const card = queue?.[0];

  const reveal = useCallback(() => {
    if (card && !revealed) setRevealed(true);
  }, [card, revealed]);

  const rate = useCallback(
    (rating: RatingName) => {
      if (!card || !revealed) return;
      void submitReview({
        id: crypto.randomUUID(),
        cardId: card.id,
        mode: "meaning",
        rating,
        reviewedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - shownAt.current),
      }).catch((e: Error) => setError(e.message));
      // A forgotten card comes back at the end of this session, like Anki's relearning step.
      setQueue((q) => (q ? (rating === "again" ? [...q.slice(1), q[0]!] : q.slice(1)) : q));
      if (rating !== "again") setDone((n) => n + 1);
      setRevealed(false);
      setStep((n) => n + 1);
      shownAt.current = performance.now();
    },
    [card, revealed],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") navigate("today");
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
  }, [revealed, reveal, rate]);

  const progress = total ? Math.min(done / total, 1) : 0;

  return (
    <main className="review">
      <header className="review-top">
        <a className="icon-button" href="#/" aria-label="Закончить повторение">
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
          <SwipeCard key={step} enabled={revealed} onTap={reveal} onSwipe={rate}>
            <p className="review-korean" lang="ko">
              {card.korean}
            </p>
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
                {card.exampleKo && (
                  <div className="review-example">
                    <p lang="ko">{card.exampleKo}</p>
                    {card.exampleMeaning && <p className="muted">{card.exampleMeaning}</p>}
                  </div>
                )}
                {card.notes && <p className="review-notes muted">{card.notes}</p>}
              </div>
            ) : (
              <p className="review-hint muted">Вспомни перевод</p>
            )}
            {canSpeak() && (
              <button
                type="button"
                className="icon-button speak-button"
                aria-label="Послушать"
                onClick={(e) => {
                  e.stopPropagation();
                  speak(card.korean);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <SpeakerIcon />
              </button>
            )}
          </SwipeCard>

          <footer className="review-actions">
            {revealed ? (
              <div className="ratings">
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

function SwipeCard({
  enabled,
  onTap,
  onSwipe,
  children,
}: {
  enabled: boolean;
  onTap: () => void;
  onSwipe: (rating: RatingName) => void;
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
    <div className="review-stage">
      <div
        className={`review-card${dx === 0 && !leaving ? " settle" : ""}${leaving ? " leaving" : ""}`}
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
