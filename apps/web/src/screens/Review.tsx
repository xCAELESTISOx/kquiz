import { shownPronunciation } from "../lib/korean";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject, type PointerEvent, type ReactNode } from "react";
import { wordsWord } from "../lib/plural";
import { api, holdReview, isConnectionError, releaseHeldReview, takeBackReview } from "../lib/api";
import { clozeFor } from "../lib/cloze";
import { useLeechIds } from "../lib/leeches";
import { everyKind, mixWays, serverModes } from "../lib/mix";
import { afterFix, afterIntro, buildable, firstTasks, insertAfter, interleave, introTask, learnTask, SESSION_TASKS, withMistake } from "../lib/session";
import { navigate } from "../lib/router";
import { canRecord, type Recorder } from "../lib/recorder";
import { canSpeak, preloadSpeech, speak } from "../lib/speech";
import { forgetVoice, heard } from "../lib/voices";
import type { Card, ChoiceOption, GroupFilter, MixKind, PhraseTiles, QueueItem, QueueMode, RatingName } from "../lib/types";
import { CloseIcon, SpeakerIcon, UndoIcon } from "../ui/icons";
import { LeechBadge } from "../ui/LeechBadge";
import { useGlide } from "../ui/motion";
import { CardNotes } from "../ui/CardNotes";
import { useFamily, WordFamily } from "../ui/WordFamily";
import { ChoiceCard } from "./Choice";
import { BuildCard, IntroCard } from "./Learn";
import { MixSetup } from "./MixSetup";
import { PhraseCard } from "./Phrase";
import { PhraseParts, RegisterBadge } from "../ui/PhraseParts";
import { SpeechCard } from "./Speech";
import { TypeCard, type TypeAsk } from "./Typing";
import "../ui/learn.css";
import "../ui/today.css";

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
 * A session ("Учить" on Today, lib/session.ts) is mixed with every way at once, runs SESSION_TASKS answers and
 * brings new words from the pool in among the reviews, each step of learning them answered to the
 * server. The tasks missed in the stretch are then gone over again, after a screen that says so,
 * until each is right: practice only, since the miss already went to the schedule. Then a summary
 * offers as many more.
 */
export function ReviewScreen({
  mode,
  group,
  all,
  session,
}: {
  mode: Extract<QueueMode, "meaning" | "listening" | "mixed">;
  group?: GroupFilter;
  /** Mixed: every way at once ("Повторить" for a group), without asking what to mix. */
  all?: boolean;
  /** "Учить": a stretch of new words and reviews together, SESSION_TASKS answers at a time. */
  session?: boolean;
}) {
  const [queue, setQueue] = useState<QueueItem[]>();
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  // The card just graded, drawn once more on its way out. Purely decorative: the next card is live at once.
  const [exit, setExit] = useState<{ step: number; rating: RatingName; card: Card }>();
  // The last rating and the session as it was before it, for going back to that card.
  const [last, setLast] = useState<{ reviewId: string; queue: QueueItem[]; done: number; mistakes: QueueItem[] }>();
  const shownAt = useRef(performance.now());
  // Mixed sessions say some cards aloud; the microphone is asked for once per session.
  const recorder = useRef<Recorder>(undefined);
  // Look-alike words for the speech items, and the ones picked from them instead of said aloud.
  const [options, setOptions] = useState<Record<number, ChoiceOption[]>>({});
  const [quiet, setQuiet] = useState<ReadonlySet<QueueItem>>(new Set());
  // The ones typed in Hangul instead: speech items by their translation, listening ones by ear.
  const [typed, setTyped] = useState<ReadonlyMap<QueueItem, TypeAsk>>(new Map());
  // Blocks for the phrases, which are built rather than recalled (Phrase.tsx).
  const [tiles, setTiles] = useState<Record<number, PhraseTiles>>({});
  // A mixed session starts once its kinds are picked.
  const [kinds, setKinds] = useState<ReadonlySet<MixKind> | undefined>(() => (all ? everyKind(group?.kind === "phrase") : undefined));
  // A session: when this stretch began, whether it is over, what it did, and answers still on their way.
  // Answers given in the session, and how many this stretch runs to.
  const [answered, setAnswered] = useState(0);
  const [goal, setGoal] = useState(SESSION_TASKS);
  const [over, setOver] = useState(false);
  const [round, setRound] = useState(0);
  // New words of this session by where they got to, and the known words reviewed: ids, so a word
  // answered in two ways or on two steps counts once.
  const [learnt, setLearnt] = useState<Record<"met" | "climbed" | "learned" | "reviewed", ReadonlySet<number>>>(() => ({
    met: new Set(),
    climbed: new Set(),
    learned: new Set(),
    reviewed: new Set(),
  }));
  const note = useCallback(
    (kind: "met" | "climbed" | "learned" | "reviewed", id: number) =>
      setLearnt((l) => (l[kind].has(id) ? l : { ...l, [kind]: new Set(l[kind]).add(id) })),
    [],
  );
  const [answering, setAnswering] = useState(0);
  // A session: the tasks missed in this stretch, and, once going over them, the ones not yet right.
  const [mistakes, setMistakes] = useState<QueueItem[]>([]);
  const [fixes, setFixes] = useState<QueueItem[]>();
  // The stretch is over: its goal is reached, or nothing is left and no answer is on its way.
  const ended = !!session && !!queue && (over || (!queue[0] && answering === 0));
  // Then first a screen for the mistakes, then the mistakes themselves, then the summary.
  const fixIntro = ended && !fixes && mistakes.length > 0;
  const fixing = ended && !!fixes && fixes.length > 0;
  const summary = ended && !fixIntro && !fixing;
  const pause = summary || fixIntro;

  useEffect(() => {
    document.title = session
      ? "Учить · KQuiz"
      : mode === "mixed"
        ? "Вперемешку · KQuiz"
        : mode === "listening"
          ? "На слух · KQuiz"
          : "Повторение · KQuiz";
    if (mode === "mixed" && !kinds) return;
    const modes = kinds && serverModes(kinds);
    Promise.all([
      group ? api.group(mode, group, modes) : api.queue(mode, mode === "mixed" ? 200 : undefined, modes),
      session ? api.learning() : { items: [], pool: 0 },
    ]).then(
      async ([{ items: all }, learning]) => {
        const fresh = firstTasks(learning.items, canSpeak());
        // Look-alikes give the wrong options for picking a word.
        const ids = [
          ...new Set([
            ...all.filter((i) => i.mode === "speech").map((i) => i.card.id),
            ...fresh.map((i) => i.card.id),
          ]),
        ];
        const { options } = ids.length
          ? await api.choices(ids).catch(() => ({ options: {} as Record<number, ChoiceOption[]> }))
          : { options: {} };
        // A single-mode session asks every item its own way.
        const ways = mixWays(all, kinds ?? new Set([mode as MixKind]), {
          record: canRecord(),
          pick: (i) => (options[i.card.id]?.length ?? 0) > 0,
        });
        const items = interleave(all.filter((i) => ways.has(i)), fresh);
        const phrases = items.filter((i) => i.learn ? i.card.kind === "phrase" : builds(i, ways.get(i) === "dictation"));
        const { tiles } = phrases.length
          ? await api.blocks(phrases.map((i) => i.card.id)).catch(() => ({ tiles: {} as Record<number, PhraseTiles> }))
          : { tiles: {} };
        setTiles(tiles);
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
  }, [mode, kinds, round]);

  const item = pause ? undefined : fixing ? fixes![0] : queue?.[0];
  const card = item?.card;
  const learning = !!item?.learn;
  const listening = item?.mode === "listening";
  const typing = item ? typed.get(item) : undefined;
  const building = !!item && builds(item, typing === "sound");
  // Said, picked, typed or built: such a card grades itself and takes its own keys. So does learning.
  const speaking = item?.mode === "speech" || !!typing || building || learning;
  // Listening shows no text before the answer, so only meaning reviews ask through an example.
  const cloze = useMemo(() => (item?.mode === "meaning" ? clozeFor(item) : undefined), [item]);
  const families = useFamily(card);
  const leeches = useLeechIds(item?.mode ?? (mode === "listening" ? "listening" : "meaning"));

  // Leaving the screen ends the chance to go back, so the held rating goes out.
  useEffect(() => () => void releaseHeldReview(), []);
  useEffect(() => () => recorder.current?.close(), []);

  // The next few too, so their audio is ready by the time they come up (listening plays the next
  // card straight from the grading tap).
  useEffect(() => {
    if (!queue) return;
    preloadSpeech(...queue.slice(0, 3).map(heard));
  }, [queue]);

  /** One more answer in a session; the stretch is over once it reaches its goal. */
  const count = useCallback(() => {
    if (!session) return;
    const n = answered + 1;
    setAnswered(n);
    if (n >= goal) setOver(true);
  }, [session, answered, goal]);

  /** A mistake gone over: right, it is done; wrong, it comes again after the others. */
  const fixed = useCallback(
    (ok: boolean) => {
      if (!fixes) return;
      const next = afterFix(fixes, ok);
      setFixes(next);
      setExit(undefined);
      setRevealed(false);
      setStep((n) => n + 1);
      shownAt.current = performance.now();
      // Inside the tap, where iOS still lets audio play.
      if (next[0]?.mode === "listening") speak(heard(next[0]));
    },
    [fixes],
  );

  /** "Исправить": the mistakes of this stretch, in the order they were made. */
  const startFixes = useCallback(() => {
    setLast(undefined);
    void releaseHeldReview();
    setFixes(mistakes);
    setStep((n) => n + 1);
    shownAt.current = performance.now();
    if (mistakes[0]?.mode === "listening") speak(heard(mistakes[0]));
  }, [mistakes]);

  const reveal = useCallback(() => {
    if (card && !revealed) setRevealed(true);
  }, [card, revealed]);

  const rate = useCallback(
    (rating: RatingName, swiped = false) => {
      if (!item || !card || !revealed || !queue || speaking) return;
      if (fixing) {
        fixed(rating !== "again");
        // A swiped card has already flown off under the finger.
        if (!swiped) setExit({ step, rating, card });
        return;
      }
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
      setLast({ reviewId, queue, done, mistakes });
      // A forgotten card comes back at the end of this session, like Anki's relearning step, and
      // is heard in a new voice then. In "Учить" that is the mistakes gone over after the stretch.
      if (rating === "again") forgetVoice(item);
      if (rating === "again" && session) setMistakes((m) => withMistake(m, item));
      const next = rating === "again" && !session ? [...queue.slice(1), queue[0]!] : queue.slice(1);
      setQueue(next);
      // Inside the tap, where iOS still lets audio play.
      if (next?.[0]?.mode === "listening") speak(heard(next[0]));
      if (rating !== "again") setDone((n) => n + 1);
      note("reviewed", card.id);
      setRevealed(false);
      setStep((n) => n + 1);
      shownAt.current = performance.now();
      count();
    },
    [item, card, revealed, step, queue, done, speaking, count, note, fixing, fixed, mistakes, session],
  );

  /** A card said aloud has sent its own rating; the session moves on. */
  const spoken = useCallback(
    (rating: RatingName) => {
      if (!queue) return;
      // A mistake gone over is practice: its card sent nothing.
      if (fixing) return fixed(rating !== "again");
      // Going back over it would rate it twice, so the held rating goes out now.
      setLast(undefined);
      void releaseHeldReview();
      setExit(undefined);
      if (rating === "again") forgetVoice(queue[0]!);
      if (rating === "again" && session) setMistakes((m) => withMistake(m, queue[0]!));
      const next = rating === "again" && !session ? [...queue.slice(1), queue[0]!] : queue.slice(1);
      setQueue(next);
      if (next[0]?.mode === "listening") speak(heard(next[0]));
      if (rating !== "again") setDone((n) => n + 1);
      note("reviewed", queue[0]!.card.id);
      setRevealed(false);
      setStep((n) => n + 1);
      shownAt.current = performance.now();
      count();
    },
    [queue, count, note, fixing, fixed, session],
  );

  /** Look-alikes and blocks for a new word that joins the session midway. */
  const prepare = useCallback((joining: Card) => {
    preloadSpeech(joining);
    api.choices([joining.id]).then(({ options: o }) => setOptions((all) => ({ ...all, ...o })), () => undefined);
    if (joining.kind === "phrase") api.blocks([joining.id]).then(({ tiles: t }) => setTiles((all) => ({ ...all, ...t })), () => undefined);
  }, []);

  /**
   * A step of learning a new word is done. Meeting it is followed at once by tasks on it (afterIntro); an answer
   * goes to the server, which says where the word stands now: its next step comes back a few cards
   * on, or it has climbed its ladder (and the next word from the pool joins), or it is learned.
   */
  const learned = useCallback(
    (ok: boolean) => {
      if (!queue || !item?.learn) return;
      // A mistake gone over is practice: the ladder on the server already has the miss.
      if (fixing) return fixed(ok);
      if (!ok) setMistakes((m) => withMistake(m, item));
      setLast(undefined);
      void releaseHeldReview();
      setExit(undefined);
      const rest = queue.slice(1);
      const word = item.card;
      note("met", word.id);
      const kind = item.learn.kind;
      // Meeting a word is followed at once by tasks on it; a missed pick comes back a few cards on.
      const next =
        kind === "intro"
          ? [...afterIntro(word, options[word.id] ?? [], { hear: canSpeak(), say: canSay(word) }), ...rest]
          : kind === "choose" && !ok
            ? insertAfter([item, ...rest], item).slice(1)
            : rest;
      setQueue(next);
      // Inside the tap, where iOS still lets audio play.
      if (next[0]?.mode === "listening") speak(heard(next[0]));
      setStep((n) => n + 1);
      shownAt.current = performance.now();
      // Meeting a word is a screen of the session too, so the count moves from the first tap.
      count();
      // Picking and saying are practice on the spot; the ladder on the server starts with building.
      if (kind === "choose" || kind === "aloud") return;
      // A word of one syllable has nothing to build: meeting it climbs that step.
      if (kind === "intro" && buildable(word)) return;
      setAnswering((n) => n + 1);
      api
        .answerLearning(word.id, ok)
        .then(
          (res) => {
            if (res.status === "climbed" || res.status === "missed") setQueue((q) => insertAfter(q ?? [], learnTask(word, res.step, canSpeak())));
            else if (res.status === "passed") {
              note("climbed", word.id);
              if (res.next) {
                prepare(res.next.card);
                setQueue((q) => insertAfter(q ?? [], introTask(res.next!.card)));
              }
            } else note("learned", word.id);
          },
          // No connection even after a second try: the word stays where it was and comes up again
          // next time, which is not worth a red banner over the session.
          (e: Error) => !isConnectionError(e) && setError(e.message),
        )
        .finally(() => setAnswering((n) => n - 1));
    },
    [queue, item, prepare, count, options, note, fixing, fixed],
  );

  /** "Ещё": as many answers again; the same queue goes on, or a fresh one if it ran out. */
  const more = useCallback(() => {
    setGoal(answered + SESSION_TASKS);
    setOver(false);
    setMistakes([]);
    setFixes(undefined);
    if (!queue?.length) {
      setQueue(undefined);
      setRound((r) => r + 1);
    }
  }, [queue, answered]);

  /** Brings the last card back with its answer open, so it can be graded again. */
  const back = useCallback(() => {
    if (!last || pause || fixing) return;
    setLast(undefined);
    // Already sent (the screen was left and reopened): that rating stays.
    if (!takeBackReview(last.reviewId)) return;
    setQueue(last.queue);
    setDone(last.done);
    setMistakes(last.mistakes);
    setExit(undefined);
    setRevealed(true);
    setStep((n) => n + 1);
    shownAt.current = performance.now();
  }, [last, pause, fixing]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") navigate("today");
      // The screens between cards take their own taps.
      else if (pause) return;
      else if (e.key === "Backspace" || e.key === "z" || e.key === "я") back();
      // The card said aloud takes its own keys.
      else if (speaking) return;
      else if (listening && item && (e.key === "r" || e.key === "к")) speak(heard(item));
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
  }, [revealed, reveal, rate, back, listening, speaking, item, pause]);

  const stretch = SESSION_TASKS - (goal - answered);
  const right = mistakes.length - (fixes?.length ?? 0);
  const progress = fixing
    ? right / mistakes.length
    : session
      ? Math.min(Math.max(stretch / SESSION_TASKS, 0), 1)
      : total
        ? Math.min(done / total, 1)
        : 0;

  return (
    <main className="review">
      <header className="review-top">
        <a className="icon-button" href="#/" aria-label={mode === "listening" ? "Закончить тренировку на слух" : "Закончить повторение"}>
          <CloseIcon />
        </a>
        <div className={`progress${fixing ? " is-fix" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="review-count">
          {session ? (pause ? "" : fixing ? `${right} / ${mistakes.length}` : `${stretch} / ${SESSION_TASKS}`) : mode !== "mixed" || kinds ? `${Math.min(done, total)} / ${total}` : ""}
        </span>
        <button
          type="button"
          className="icon-button review-back"
          aria-label="Вернуть предыдущую карточку"
          title="Вернуть предыдущую карточку"
          disabled={!last}
          hidden={pause || fixing}
          onClick={back}
        >
          <UndoIcon />
        </button>
      </header>

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      {mode === "mixed" && !kinds && <MixSetup counted={!group} phrases={group?.kind === "phrase"} onStart={setKinds} />}

      {!queue && !error && (mode !== "mixed" || kinds) && <div className="review-stage" aria-busy="true" />}

      {fixIntro && <FixIntro mistakes={mistakes} onStart={startFixes} />}

      {summary && <SessionDone {...learnt} onMore={more} empty={!queue[0]} />}

      {!session && queue && !card && <Finished count={done} />}

      {session && queue && !card && !pause && <div className="review-stage" aria-busy="true" />}

      {queue && item?.learn && (
        <LearnStep key={step} item={item} options={options[item.card.id] ?? []} tiles={tiles[item.card.id]} recorder={recorder} onDone={learned} />
      )}

      {!learning && queue && item && building && (
        <PhraseCard
          key={step}
          item={item}
          tiles={tiles[item.card.id]}
          ask={item.mode === "listening" ? "sound" : "meaning"}
          practice={fixing}
          onDone={spoken}
        />
      )}

      {!learning && queue && item && typing && !building && <TypeCard key={step} item={item} ask={typing} practice={fixing} onDone={spoken} />}

      {!learning && queue && item && speaking && !typing && !building && (quiet.has(item) ? (
        <ChoiceCard
          key={step}
          item={item}
          options={options[item.card.id] ?? []}
          practice={fixing}
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
          practice={fixing}
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
                {cloze && (
                  <p className="review-word" lang="ko">
                    {card.korean}
                  </p>
                )}
                {shownPronunciation(card) || card.romanization ? (
                  <p className="review-pron">
                    {shownPronunciation(card) && (
                      <span lang="ko">[{shownPronunciation(card)}]</span>
                    )}
                    {card.romanization && <span className="muted">{card.romanization}</span>}
                  </p>
                ) : null}
                <p className="review-meaning">{card.meaning}</p>
                <RegisterBadge card={card} />
                <PhraseParts card={card} />
                {card.examples.length > 0 && (
                  <ul className="review-examples">
                    {card.examples.map((example, i) => (
                      <Example key={i} ko={example.ko} ru={example.ru} />
                    ))}
                  </ul>
                )}
                <WordFamily card={card} families={families} />
                <CardNotes card={card} />
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

/** A new word can be said and scored right after meeting it. */
const canSay = (card: Card): boolean => canRecord() && card.kind === "word" && card.speakable && card.readyForSpeech;

/** One step of learning a new word in a session: met, built, picked out by ear or written. */
function LearnStep({
  item,
  options,
  tiles,
  recorder,
  onDone,
}: {
  item: QueueItem;
  options: ChoiceOption[];
  tiles: PhraseTiles | undefined;
  recorder: RefObject<Recorder | undefined>;
  onDone: (ok: boolean) => void;
}) {
  const kind = item.learn!.kind;
  const { card } = item;
  if (kind === "intro") return <IntroCard card={card} onDone={() => onDone(true)} />;
  if (kind === "choose") return <ChoiceCard item={item} options={options} practice instant onDone={(r) => onDone(r !== "again")} />;
  if (kind === "aloud") return <SpeechCard item={item} recorder={recorder} practice onRated={(r) => onDone(r !== "again")} />;
  if (card.kind === "phrase")
    return <PhraseCard item={item} tiles={tiles} ask={kind === "dictation" ? "sound" : "meaning"} practice onDone={(r) => onDone(r !== "again")} />;
  if (kind === "build") return <BuildCard card={card} options={options} onDone={onDone} />;
  return <TypeCard item={item} ask={kind === "dictation" ? "sound" : "meaning"} practice onDone={(r) => onDone(r === "good")} />;
}

/**
 * Between the stretch and its summary: the tasks missed are gone over again, and this says so
 * first, with the words they were on.
 */
function FixIntro({ mistakes, onStart }: { mistakes: readonly QueueItem[]; onStart: () => void }) {
  const n = mistakes.length;
  const words = [...new Map(mistakes.map((m) => [m.card.id, m.card])).values()];
  return (
    <div className="review-stage">
      <div className="finished fix-intro">
        <p className="fix-intro-mark" aria-hidden="true">
          <span lang="ko">다시</span>
        </p>
        <h1 className="fix-intro-title">Теперь исправим ошибки</h1>
        <p className="finished-text muted">
          {n === 1 ? "В одном задании была ошибка." : `Ошибки были в ${n} ${inTasks(n)}.`} Пройдём {n === 1 ? "его" : "их"} ещё
          раз, пока всё не будет верно. На расписание это не влияет: ошибка уже учтена.
        </p>
        <ul className="fix-intro-words" aria-label="Слова с ошибками">
          {words.map((w, i) => (
            <li key={w.id} lang="ko" style={{ "--i": i } as CSSProperties}>
              {w.korean}
            </li>
          ))}
        </ul>
        <button type="button" className="button primary" onClick={onStart} autoFocus>
          Исправить
        </button>
      </div>
    </div>
  );
}

/** Prepositional after a number: в 2 заданиях, в 21 задании. */
const inTasks = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? "задании" : "заданиях");

/** The end of a session's stretch: where its words got to, in words, and "Ещё" for another. */
function SessionDone({
  met,
  climbed,
  learned,
  reviewed,
  empty,
  onMore,
}: Record<"met" | "climbed" | "learned" | "reviewed", ReadonlySet<number>> & { empty: boolean; onMore: () => void }) {
  // A word checked and learned climbed its ladder in an earlier session; one that climbed now waits.
  const waiting = [...climbed].filter((id) => !learned.has(id)).length;
  const learning = [...met].filter((id) => !climbed.has(id) && !learned.has(id)).length;
  const rows = (
    [
      ["learned", learned.size, "выучено", one(learned.size, "прошло проверку и теперь в повторении", "прошли проверку и теперь в повторении")],
      [
        "climbed",
        waiting,
        "почти выучено",
        one(
          waiting,
          "прошло все шаги. Через 3 часа спрошу ещё раз, и оно станет выученным",
          "прошли все шаги. Через 3 часа спрошу ещё раз, и они станут выученными",
        ),
      ],
      ["learning", learning, "в процессе", "в следующем подходе продолжите с того же шага"],
      ["reviewed", reviewed.size, "повторено", "из уже выученных: освежили в памяти"],
    ] as const
  ).filter(([, n]) => n > 0);
  return (
    <div className="review-stage">
      <div className="finished session-done">
        <p className="finished-mark" lang="ko">
          {empty ? "다 했어요" : "잘했어요!"}
        </p>
        {rows.length > 0 && (
          <ul className="session-rows">
            {rows.map(([kind, n, what, why]) => (
              <li key={kind} data-kind={kind}>
                <span className="session-rows-n">{n}</span>
                <span>
                  <b>
                    {wordsWord(n)} {what}
                  </b>
                  <span className="muted">{why}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="finished-text muted">
          {empty
            ? "Сейчас учить и повторять больше нечего. Новые слова можно добавить в любой момент."
            : "Можно остановиться или пройти ещё один подход."}
        </p>
        <div className="session-done-actions">
          {!empty && (
            <button type="button" className="button primary" onClick={onMore}>
              Ещё подход
            </button>
          )}
          <a className={`button${empty ? " primary" : ""}`} href="#/">
            На главную
          </a>
        </div>
      </div>
    </div>
  );
}

/** Singular for one word, plural otherwise (21 is "one" too). */
function one(n: number, singular: string, plural: string): string {
  return n % 10 === 1 && n % 100 !== 11 ? singular : plural;
}

/** A phrase is built from blocks: from its translation, or from what is heard when typed by ear would be asked. */
function builds(item: QueueItem, byEar: boolean): boolean {
  return item.card.kind === "phrase" && (item.mode === "meaning" || (item.mode === "listening" && byEar));
}

function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
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
