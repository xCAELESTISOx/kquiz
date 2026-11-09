import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, submitReview } from "../lib/api";
import { logAnswer } from "../lib/sessionLog";
import { useLeechIds } from "../lib/leeches";
import { groupHash, navigate } from "../lib/router";
import { choiceRating, REVEAL_MS, shuffled } from "../lib/choice";
import { canSpeak, preloadSpeech, speak } from "../lib/speech";
import type { ChoiceOption, GroupFilter, QueueItem, RatingName, SimilarWord } from "../lib/types";
import { CloseIcon, SpeakerIcon } from "../ui/icons";
import { LeechBadge } from "../ui/LeechBadge";
import { SimilarList, SimilarNudge } from "../ui/Similar";
import { afterNudge } from "../lib/similar";
import "../ui/practice.css";

/**
 * The quiet alternative to saying the word aloud: the translation is shown, pick the Korean among a few
 * of your own look-alike words. It reviews the same "speech" schedule, so on the subway the day's
 * words can be done here and at home out loud. The rating follows from the pick. With a group, the
 * cards picked on the cards screen come instead of the day's queue.
 */
export function ChoiceScreen({ group }: { group?: GroupFilter }) {
  const [queue, setQueue] = useState<QueueItem[]>();
  const [options, setOptions] = useState<Record<number, ChoiceOption[]>>({});
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => {
    document.title = "Choose · KQuiz";
    (group ? api.group("speech", group) : api.queue("speech"))
      .then(async ({ items }) => {
        const { options } = items.length ? await api.choices(items.map((i) => i.card.id)) : { options: {} };
        setOptions(options);
        setQueue(items);
        setTotal(items.length);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const item = queue?.[0];

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

  const next = useCallback((rating: RatingName) => {
    const again = rating === "again";
    setQueue((q) => (q ? (again ? [...q.slice(1), q[0]!] : q.slice(1)) : q));
    if (!again) setDone((n) => n + 1);
    setStep((n) => n + 1);
  }, []);

  const progress = total ? Math.min(done / total, 1) : 0;

  return (
    <main className="review choice">
      <header className="review-top">
        <a className="icon-button" href="#/" aria-label="Finish">
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
        <ChoiceCard
          key={step}
          item={item}
          options={options[item.card.id] ?? []}
          onDone={next}
          aloud={<a href={group ? groupHash("speech", group) : "#/speech"}>record your voice</a>}
        />
      )}
    </main>
  );
}

/** Picked when the word isn't known at all: counts as a wrong pick and shows the right one. */
const DONT_KNOW = -1;

/**
 * One card picked among look-alikes. The options come a few seconds after the meaning (or at once
 * with "Show options"), so the word is recalled first and only then recognised. Sends its
 * rating to the speech schedule as soon as the pick is made; "Next" tells the session. A fresh one
 * (keyed) per showing, so the order is shuffled anew. `aloud` offers saying it instead.
 */
export function ChoiceCard({
  item,
  options,
  onDone,
  aloud,
  practice,
  instant,
}: {
  item: QueueItem;
  options: ChoiceOption[];
  onDone: (rating: RatingName) => void;
  aloud?: ReactNode;
  /** Learning one word: the pick grades nothing. */
  practice?: boolean;
  /** Options at once, without the recall pause: the word was shown a moment ago. */
  instant?: boolean;
}) {
  const { card } = item;
  const [picked, setPicked] = useState<number>();
  const [error, setError] = useState<string>();
  const shownAt = useRef(performance.now());
  const [revealed, setRevealed] = useState(!!instant);
  const revealedAt = useRef(instant ? performance.now() : 0);
  const rating = useRef<RatingName>("good");
  const leeches = useLeechIds("speech");
  // Similar words picked instead (휴지통 for 쓰레기통): each is said so and set aside, the pick goes on.
  const [nudges, setNudges] = useState<SimilarWord[]>([]);

  const choices = useMemo(
    () => shuffled([{ id: card.id, korean: card.korean, meaning: card.meaning }, ...options]),
    [card, options],
  );

  const reveal = useCallback(() => {
    if (revealedAt.current) return;
    revealedAt.current = performance.now();
    setRevealed(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(reveal, REVEAL_MS);
    return () => clearTimeout(timer);
  }, [reveal]);

  const pick = useCallback(
    (id: number) => {
      if (picked !== undefined) {
        // After the answer, each option can be heard to compare.
        const other = choices.find((c) => c.id === id);
        if (other && canSpeak()) speak(other);
        return;
      }
      if (nudges.some((w) => w.id === id)) return;
      const similar = card.similar?.find((w) => w.id === id);
      if (similar) {
        logAnswer({ given: similar.korean, expected: card.korean, note: "similar word, asked again" });
        setNudges((list) => [...list, similar]);
        return;
      }
      const correct = id === card.id;
      logAnswer({
        given: id === DONT_KNOW ? "" : (choices.find((c) => c.id === id)?.korean ?? String(id)),
        expected: card.korean,
        options: choices.map((c) => c.korean),
        ok: correct,
        ...(revealedAt.current ? {} : { note: "before the options showed" }),
      });
      const now = performance.now();
      const elapsedMs = Math.round(now - shownAt.current);
      // "Don't know" can come before the options; then there is no pick time to count.
      rating.current = afterNudge(choiceRating(correct, revealedAt.current ? now - revealedAt.current : 0), nudges.length > 0);
      setPicked(id);
      if (canSpeak()) speak(card);
      if (!practice)
        void submitReview({
          id: crypto.randomUUID(),
          cardId: card.id,
          mode: "speech",
          rating: rating.current,
          reviewedAt: new Date().toISOString(),
          elapsedMs,
        }).catch((e: Error) => setError(e.message));
    },
    [card, picked, choices, practice, nudges],
  );

  const next = useCallback(() => {
    if (picked !== undefined) onDone(rating.current);
  }, [picked, onDone]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!revealed) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          reveal();
        }
      } else if (/^[1-4]$/.test(e.key) && choices[Number(e.key) - 1]) pick(choices[Number(e.key) - 1]!.id);
      else if ((e.key === "Enter" || e.key === " ") && picked !== undefined) {
        e.preventDefault();
        next();
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [choices, pick, next, picked, revealed, reveal]);

  const answered = picked !== undefined;
  const right = picked === card.id;

  return (
    <>
      <div className="review-stage">
        <div className="review-card choice-card">
          {leeches.has(card.id) && <LeechBadge />}
          <p className="speech-ask">Choose it in Korean</p>
          <p className="speech-meaning">{card.meaning}</p>
          {answered && canSpeak() && (
            <button type="button" className="icon-button speak-button" aria-label="Listen to the word" onClick={() => speak(card)}>
              <SpeakerIcon />
            </button>
          )}
          {!answered && nudges.length > 0 && <SimilarNudge key={nudges.at(-1)!.id} word={nudges.at(-1)!} />}
          {answered && nudges.length > 0 && <SimilarList card={card} />}
        </div>
      </div>

      <div aria-live="polite">
        {error && <p className="notice notice-error speech-notice">{error}</p>}
        {answered && (
          <p className={`sounds-feedback tone-${right ? "ok" : "wrong"}`}>
            {right ? (nudges.length ? "Correct, with a hint" : rating.current === "hard" ? "Correct, but slow" : "Correct") : <>Answer: <span lang="ko">{card.korean}</span></>}
          </p>
        )}
      </div>

      <footer className="review-actions">
        {/* Picking "Don't know" before the options also shows them, with the right one marked. */}
        {!revealed && !answered ? (
          <button
            type="button"
            className="choice-reveal"
            style={{ "--reveal-ms": `${REVEAL_MS}ms` } as CSSProperties}
            onClick={reveal}
          >
            <span className="choice-reveal-ask">Recall the word</span>
            <span className="choice-reveal-action">Show options</span>
            <span className="choice-reveal-bar" aria-hidden="true" />
          </button>
        ) : (
          <div className="sounds-options choice-options" data-count={choices.length}>
            {choices.map((c, i) => {
              const set = nudges.some((w) => w.id === c.id);
              const state = set && !answered ? "similar" : !answered ? undefined : c.id === card.id ? "right" : c.id === picked ? "wrong" : "other";
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
                  {(answered || set) && <span className="sounds-option-meaning">{c.meaning}</span>}
                </button>
              );
            })}
          </div>
        )}
        {answered ? (
          <>
            <button type="button" className="button primary" onClick={next}>
              Next
            </button>
            <p className="review-tip muted small">Tap the words to hear them</p>
          </>
        ) : (
          <>
            <button type="button" className="chip-button dont-know" onClick={() => pick(DONT_KNOW)}>
              Don't know
            </button>
            {aloud && <p className="review-tip muted small">Or say it aloud: {aloud}</p>}
          </>
        )}
      </footer>
    </>
  );
}

function Finished({ count }: { count: number }) {
  return (
    <div className="review-stage">
      <div className="finished">
        <p className="finished-mark" lang="ko">
          잘했어요!
        </p>
        <p className="finished-text">{count ? `Words chosen: ${count}. That's all for today.` : "Nothing to review right now."}</p>
        <a className="button primary" href="#/">
          Home
        </a>
      </div>
    </div>
  );
}
