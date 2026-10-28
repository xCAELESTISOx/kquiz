import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { api, holdReview, releaseHeldReview, takeBackReview } from "../lib/api";
import { shuffled } from "../lib/choice";
import { clozeFor } from "../lib/cloze";
import { guessHints, isFirstShow, splitAt, type GuessHint } from "../lib/guess";
import { useLeechIds } from "../lib/leeches";
import { mixWays, serverModes } from "../lib/mix";
import { navigate } from "../lib/router";
import { canRecord, type Recorder } from "../lib/recorder";
import { canSpeak, preloadSpeech, speak } from "../lib/speech";
import { forgetVoice, heard } from "../lib/voices";
import type { Card, ChoiceOption, GroupFilter, MixKind, QueueItem, QueueMode, RatingName } from "../lib/types";
import { CloseIcon, SpeakerIcon, UndoIcon } from "../ui/icons";
import { LeechBadge } from "../ui/LeechBadge";
import { useGlide } from "../ui/motion";
import { useFamily, WordFamily } from "../ui/WordFamily";
import { ChoiceCard } from "./Choice";
import { MixSetup } from "./MixSetup";
import { SpeechCard } from "./Speech";
import { TypeCard, type TypeAsk } from "./Typing";
import "../ui/guess.css";

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
 * item's own mode, and the speech schedule is gone through partly aloud, partly by picking from options.
 * What goes into the mix is picked first (MixSetup).
 * A new word asked for its meaning the first time, when it shares a root with words already well
 * learned, is guessed first from those words among a few translations; the answer and grading follow.
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
  // Look-alike words for the speech items, and the ones picked from them instead of said aloud.
  const [options, setOptions] = useState<Record<number, ChoiceOption[]>>({});
  const [quiet, setQuiet] = useState<ReadonlySet<QueueItem>>(new Set());
  // The ones typed in Hangul instead: speech items by their translation, listening ones by ear.
  const [typed, setTyped] = useState<ReadonlyMap<QueueItem, TypeAsk>>(new Map());
  // A mixed session starts once its kinds are picked.
  const [kinds, setKinds] = useState<ReadonlySet<MixKind>>();
  // The translation picked when guessing a new word, or null for "не знаю"; reset with each card.
  const [guess, setGuess] = useState<{ step: number; meaning: string | null }>();

  useEffect(() => {
    document.title = mode === "mixed" ? "Вперемешку · KQuiz" : mode === "listening" ? "На слух · KQuiz" : "Повторение · KQuiz";
    if (mode === "mixed" && !kinds) return;
    const modes = kinds && serverModes(kinds);
    (group ? api.group(mode, group, modes) : api.queue(mode, mode === "mixed" ? 200 : undefined, modes)).then(
      async ({ items: all }) => {
        // Look-alikes give the wrong options for picking a word, and their translations for guessing a new one.
        const ids = [...new Set(all.filter((i) => i.mode === "speech" || isFirstShow(i)).map((i) => i.card.id))];
        const { options } = ids.length
          ? await api.choices(ids).catch(() => ({ options: {} as Record<number, ChoiceOption[]> }))
          : { options: {} };
        // A single-mode session asks every item its own way.
        const ways = mixWays(all, kinds ?? new Set([mode as MixKind]), {
          record: canRecord(),
          pick: (i) => (options[i.card.id]?.length ?? 0) > 0,
        });
        const items = all.filter((i) => ways.has(i));
        setOptions(options);
        setQuiet(new Set(items.filter((i) => ways.get(i) === "choice")));
        setTyped(
          new Map(items.flatMap((i): [QueueItem, TypeAsk][] => (ways.get(i) === "write" ? [[i, "meaning"]] : ways.get(i) === "dictation" ? [[i, "sound"]] : []))),
        );
        setQueue(items);
        setTotal(items.length);
        shownAt.current = performance.now();
        // The tap that opened the screen may still count; if not, the big button is right there.
        if (items[0]?.mode === "listening") speak(heard(items[0]));
      },
      (e: Error) => setError(e.message),
    );
    // A new group is a new screen (App keys it), so `group` never changes here.
  }, [mode, kinds]);

  const item = queue?.[0];
  const card = item?.card;
  const listening = item?.mode === "listening";
  const typing = item ? typed.get(item) : undefined;
  // Said, picked or typed: such a card grades itself and takes its own keys.
  const speaking = item?.mode === "speech" || !!typing;
  // Listening shows no text before the answer, so only meaning reviews ask through an example.
  const cloze = useMemo(() => (item?.mode === "meaning" ? clozeFor(item) : undefined), [item]);
  const families = useFamily(card);
  const hints = useMemo(() => (item && families && isFirstShow(item) ? guessHints(families) : []), [item, families]);
  const guessed = guess?.step === step ? guess : undefined;
  // Translations to guess among: this word's and those of a few look-alikes, with no two alike.
  const guesses = useMemo(() => {
    if (!card || !hints.length) return [];
    const others = [...new Set((options[card.id] ?? []).map((o) => o.meaning))].filter((m) => m !== card.meaning).slice(0, 3);
    return others.length ? shuffled([card.meaning, ...others]) : [];
  }, [card, hints, options]);
  const guessing = guesses.length > 0 && !revealed;
  const leeches = useLeechIds(item?.mode ?? (mode === "listening" ? "listening" : "meaning"));

  // Leaving the screen ends the chance to go back, so the held rating goes out.
  useEffect(() => () => void releaseHeldReview(), []);
  useEffect(() => () => recorder.current?.close(), []);

  // The next few too, so their audio is ready by the time they come up (listening plays the next
  // card straight from the grading tap).
  useEffect(() => {
    if (!queue) return;
    preloadSpeech(...queue.slice(0, 3).map(heard));
    // And the families of new words, so the guess is there as the card comes up, not a moment later.
    for (const i of queue.slice(0, 3)) if (isFirstShow(i) && i.card.roots?.length) api.family(i.card).catch(() => undefined);
  }, [queue]);

  const reveal = useCallback(() => {
    if (card && !revealed) setRevealed(true);
  }, [card, revealed]);

  /** A guess at a new word's meaning, right or not, opens the answer; the grading is as usual. */
  const pickGuess = useCallback(
    (meaning: string | null) => {
      if (!guessing) return;
      setGuess({ step, meaning });
      setRevealed(true);
    },
    [guessing, step],
  );

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
      // A forgotten card comes back at the end of this session, like Anki's relearning step, and
      // is heard in a new voice then.
      if (rating === "again") forgetVoice(item);
      const next = queue ? (rating === "again" ? [...queue.slice(1), queue[0]!] : queue.slice(1)) : queue;
      setQueue(next);
      // Inside the tap, where iOS still lets audio play.
      if (next?.[0]?.mode === "listening") speak(heard(next[0]));
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
      if (rating === "again") forgetVoice(queue[0]!);
      const next = rating === "again" ? [...queue.slice(1), queue[0]!] : queue.slice(1);
      setQueue(next);
      if (next[0]?.mode === "listening") speak(heard(next[0]));
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
      else if (listening && item && (e.key === "r" || e.key === "к")) speak(heard(item));
      else if (guessing && /^[1-4]$/.test(e.key) && guesses[Number(e.key) - 1]) pickGuess(guesses[Number(e.key) - 1]!);
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
  }, [revealed, reveal, rate, back, listening, speaking, item, guessing, guesses, pickGuess]);

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
        <span className="review-count">{mode !== "mixed" || kinds ? `${Math.min(done, total)} / ${total}` : ""}</span>
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

      {mode === "mixed" && !kinds && <MixSetup counted={!group} onStart={setKinds} />}

      {!queue && !error && (mode !== "mixed" || kinds) && <div className="review-stage" aria-busy="true" />}

      {queue && !card && <Finished count={done} />}

      {queue && item && typing && <TypeCard key={step} item={item} ask={typing} onDone={spoken} />}

      {queue && item && speaking && !typing && (quiet.has(item) ? (
        <ChoiceCard
          key={step}
          item={item}
          options={options[item.card.id] ?? []}
          onDone={spoken}
          aloud={canRecord() && (
            <button type="button" className="link-button inline" onClick={() => setQuiet((s) => toggled(s, item))}>
              записать голосом
            </button>
          )}
        />
      ) : (
        <SpeechCard
          key={step}
          item={item}
          recorder={recorder}
          onRated={spoken}
          quiet={(options[item.card.id]?.length ?? 0) > 0 && (
            <button type="button" className="link-button inline" onClick={() => setQuiet((s) => toggled(s, item))}>
              Выбрать из вариантов
            </button>
          )}
        />
      ))}

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
                  speak(heard(item));
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
                {guessed && <GuessResult picked={guessed.meaning} meaning={card.meaning} />}
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
                <WordFamily card={card} families={families} />
                {card.notes && <p className="review-notes muted">{card.notes}</p>}
              </div>
            ) : guessing ? (
              <GuessHints hints={hints} />
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
                  speak(heard(item));
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
            ) : guessing ? (
              <>
                <div className="guess-options">
                  {guesses.map((meaning, i) => (
                    <button
                      key={meaning}
                      type="button"
                      className="guess-option"
                      style={{ "--i": i } as CSSProperties}
                      onClick={() => pickGuess(meaning)}
                    >
                      {meaning}
                    </button>
                  ))}
                </div>
                <button type="button" className="chip-button dont-know" onClick={() => pickGuess(null)}>
                  Не догадываюсь
                </button>
              </>
            ) : (
              <button type="button" className="button primary" onClick={reveal}>
                Показать ответ
              </button>
            )}
            <p className="review-tip muted small">
              {revealed ? "Свайп вправо: «Хорошо», влево: «Снова»" : guessing ? "Догадка не влияет на оценку" : last && "Свайп вправо: вернуть предыдущую"}
            </p>
          </footer>
        </>
      )}
    </main>
  );
}

function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

/** Words already learned that share a part with the new one, its syllable marked: 학교, 대학 → 학생. */
function GuessHints({ hints }: { hints: GuessHint[] }) {
  return (
    <div className="guess">
      <p className="guess-ask">Новое слово. Угадай по знакомым</p>
      <ul className="guess-hints">
        {hints.flatMap((hint) =>
          hint.words.map((word) => {
            const [before, mark, after] = splitAt(word.korean, hint.syllable);
            return (
              <li key={`${hint.syllable}:${word.id}`} className="guess-hint">
                <span className="guess-word" lang="ko">
                  {before}
                  {mark && <mark>{mark}</mark>}
                  {after}
                </span>
                <span className="guess-meaning">{word.meaning}</span>
              </li>
            );
          }),
        )}
      </ul>
    </div>
  );
}

function GuessResult({ picked, meaning }: { picked: string | null; meaning: string }) {
  const right = picked === meaning;
  return (
    <p className={`guess-result tone-${right ? "ok" : picked === null ? "muted" : "wrong"}`}>
      {right ? "Угадал" : picked === null ? "Теперь запомни" : <>Ты думал: «{picked}»</>}
    </p>
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
