import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api, submitReview } from "../lib/api";
import { useLeechIds } from "../lib/leeches";
import { navigate } from "../lib/router";
import { choiceRating, shuffled } from "../lib/choice";
import { canSpeak, preloadSpeech, speak } from "../lib/speech";
import type { ChoiceOption, QueueItem, RatingName } from "../lib/types";
import { CloseIcon, SpeakerIcon } from "../ui/icons";
import { LeechBadge } from "../ui/LeechBadge";
import "../ui/practice.css";

/**
 * The quiet alternative to saying the word aloud: the Russian is shown, pick the Korean among a few
 * of your own look-alike words. It reviews the same "speech" schedule, so on the subway the day's
 * words can be done here and at home out loud. The rating follows from the pick.
 */
export function ChoiceScreen() {
  const [queue, setQueue] = useState<QueueItem[]>();
  const [options, setOptions] = useState<Record<number, ChoiceOption[]>>({});
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<number>();
  const [error, setError] = useState<string>();
  const shownAt = useRef(performance.now());
  const rating = useRef<RatingName>("good");

  useEffect(() => {
    document.title = "Выбор слова · KQuiz";
    api
      .queue("speech")
      .then(async ({ items }) => {
        const { options } = items.length ? await api.choices(items.map((i) => i.card.id)) : { options: {} };
        setOptions(options);
        setQueue(items);
        setTotal(items.length);
        shownAt.current = performance.now();
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const item = queue?.[0];
  const card = item?.card;
  const leeches = useLeechIds("speech");

  // Shuffled once per showing; a card back after "again" gets a new order.
  const choices = useMemo(
    () => (card ? shuffled([{ id: card.id, korean: card.korean, meaning: card.meaning }, ...(options[card.id] ?? [])]) : []),
    [card, options, step],
  );

  useEffect(() => {
    if (queue) preloadSpeech(...queue.slice(0, 3).map((i) => i.card));
  }, [queue]);

  const pick = useCallback(
    (id: number) => {
      if (!card) return;
      if (picked !== undefined) {
        // After the answer, each option can be heard to compare.
        const other = choices.find((c) => c.id === id);
        if (other && canSpeak()) speak(other);
        return;
      }
      const correct = id === card.id;
      const elapsedMs = Math.round(performance.now() - shownAt.current);
      rating.current = choiceRating(correct, elapsedMs);
      setPicked(id);
      if (canSpeak()) speak(card);
      void submitReview({
        id: crypto.randomUUID(),
        cardId: card.id,
        mode: "speech",
        rating: rating.current,
        reviewedAt: new Date().toISOString(),
        elapsedMs,
      }).catch((e: Error) => setError(e.message));
    },
    [card, picked, choices],
  );

  const next = useCallback(() => {
    if (picked === undefined) return;
    const again = rating.current === "again";
    setQueue((q) => (q ? (again ? [...q.slice(1), q[0]!] : q.slice(1)) : q));
    if (!again) setDone((n) => n + 1);
    setStep((n) => n + 1);
    setPicked(undefined);
    setError(undefined);
    shownAt.current = performance.now();
  }, [picked]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") navigate("today");
      else if (/^[1-4]$/.test(e.key) && choices[Number(e.key) - 1]) pick(choices[Number(e.key) - 1]!.id);
      else if ((e.key === "Enter" || e.key === " ") && picked !== undefined) {
        e.preventDefault();
        next();
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [choices, pick, next, picked]);

  const progress = total ? Math.min(done / total, 1) : 0;
  const answered = picked !== undefined;
  const right = picked === card?.id;

  return (
    <main className="review choice">
      <header className="review-top">
        <a className="icon-button" href="#/" aria-label="Закончить">
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
            <div className="review-card choice-card" key={step}>
              {leeches.has(card.id) && <LeechBadge />}
              <p className="speech-ask">Выбери по-корейски</p>
              <p className="speech-meaning">{card.meaning}</p>
              {answered && canSpeak() && (
                <button type="button" className="icon-button speak-button" aria-label="Послушать слово" onClick={() => speak(card)}>
                  <SpeakerIcon />
                </button>
              )}
            </div>
          </div>

          <div aria-live="polite">
            {error && <p className="notice notice-error speech-notice">{error}</p>}
            {answered && (
              <p className={`sounds-feedback tone-${right ? "ok" : "wrong"}`}>
                {right ? (rating.current === "hard" ? "Верно, но долго" : "Верно") : <>Правильно: <span lang="ko">{card.korean}</span></>}
              </p>
            )}
          </div>

          <footer className="review-actions">
            <div className="sounds-options choice-options" data-count={choices.length}>
              {choices.map((c, i) => {
                const state = !answered ? undefined : c.id === card.id ? "right" : c.id === picked ? "wrong" : "other";
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="sounds-option"
                    data-state={state}
                    style={{ "--i": i } as CSSProperties}
                    onClick={() => pick(c.id)}
                  >
                    <span className="sounds-option-word" lang="ko">
                      {c.korean}
                    </span>
                    {/* Translations only after the pick, or they would give the answer away. */}
                    {answered && <span className="sounds-option-meaning">{c.meaning}</span>}
                  </button>
                );
              })}
            </div>
            {answered ? (
              <>
                <button type="button" className="button primary" onClick={next}>
                  Дальше
                </button>
                <p className="review-tip muted small">Нажимай на слова, чтобы послушать</p>
              </>
            ) : (
              <p className="review-tip muted small">
                Можно и вслух: <a href="#/speech">записать голосом</a>
              </p>
            )}
          </footer>
        </>
      )}
    </main>
  );
}

function Finished({ count }: { count: number }) {
  return (
    <div className="review-stage">
      <div className="finished">
        <p className="finished-mark" lang="ko">
          잘했어요!
        </p>
        <p className="finished-text">{count ? `Выбрано слов: ${count}. На сегодня всё.` : "Сейчас повторять нечего."}</p>
        <a className="button primary" href="#/">
          На главную
        </a>
      </div>
    </div>
  );
}
