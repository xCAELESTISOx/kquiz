import { shownPronunciation } from "../lib/korean";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject, type PointerEvent, type ReactNode } from "react";
import { wordsWord } from "../lib/plural";
import { api, holdReview, isConnectionError, releaseHeldReview, takeBackReview } from "../lib/api";
import { clozeFor } from "../lib/cloze";
import { useLeechIds } from "../lib/leeches";
import { everyKind, mixWays, serverModes } from "../lib/mix";
import { afterFix, afterIntro, buildable, firstTasks, insertAfter, insertNext, interleave, introTask, learnTask, SESSION_MAX, SESSION_TASKS, onward, toFront, unfinished, withMistake } from "../lib/session";
import { navigate } from "../lib/router";
import { endLog, flushLog, logEvent, logOutcome, logServer, logShown, startLog } from "../lib/sessionLog";
import { SessionId, useLongPress, type LongPress } from "../ui/SessionId";
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
  { name: "again", label: "Again", key: "1" },
  { name: "hard", label: "Hard", key: "2" },
  { name: "good", label: "Good", key: "3" },
  { name: "easy", label: "Easy", key: "4" },
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
 * A session ("Learn" on Today, lib/session.ts) is mixed with every way at once, runs SESSION_TASKS answers and
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
  /** Mixed: every way at once ("Review" for a group), without asking what to mix. */
  all?: boolean;
  /** "Learn": a stretch of new words and reviews together, SESSION_TASKS answers at a time. */
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
  // New words begun in this stretch: past its goal it runs on (up to SESSION_MAX) only for their steps.
  const [started, setStarted] = useState<ReadonlySet<number>>(() => new Set());
  const extra = !!session && answered >= goal;
  const pending = extra && queue ? unfinished(queue, started) : 0;
  // The stretch is over: its goal is reached and its words have done their steps (or it hit
  // SESSION_MAX), or nothing is left; either way with no answer on its way.
  const ended = !!session && !!queue && (over || (answering === 0 && (extra ? pending < 0 : !queue[0])));
  // Then first a screen for the mistakes, then the mistakes themselves, then the summary.
  const fixIntro = ended && !fixes && mistakes.length > 0;
  const fixing = ended && !!fixes && fixes.length > 0;
  const summary = ended && !fixIntro && !fixing;
  const pause = summary || fixIntro;

  // Every session keeps a log for Claude to look into (lib/sessionLog.ts); its id is copied by a long press.
  useEffect(() => {
    startLog(session ? "learn" : `${group ? "group " : ""}${mode}`);
    return endLog;
  }, []);
  const [showId, setShowId] = useState(false);
  const longPress = useLongPress(() => setShowId(true));

  useEffect(() => {
    document.title = session
      ? "Learn · KQuiz"
      : mode === "mixed"
        ? "Mixed · KQuiz"
        : mode === "listening"
          ? "Listening · KQuiz"
          : "Review · KQuiz";
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
        logEvent("queue", {
          round,
          kinds: kinds ? [...kinds] : [mode],
          items: items.slice(0, 80).map((i) => `${i.card.korean} ${i.learn ? `learn:${i.learn.check ? "check" : i.learn.kind}` : `${i.mode}:${ways.get(i) ?? "recall"}`}`),
        });
        setQueue(items);
        setTotal(items.length);
        shownAt.current = performance.now();
        // The tap that opened the screen may still count; if not, the big button is right there.
        if (items[0]?.mode === "listening") speak(heard(items[0]));
      },
      (e: Error) => {
        logEvent("error", { message: e.message });
        setError(e.message);
      },
    );
    // A new group is a new screen (App keys it), so `group` never changes here.
  }, [mode, kinds, round]);

  // Past the goal the step still due is brought to the front first (below), so the queue's head stays the card on screen.
  const item = pause ? undefined : fixing ? fixes![0] : extra && pending !== 0 ? undefined : queue?.[0];
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

  // Past the goal, the next step of a word begun in this stretch comes before anything else.
  useLayoutEffect(() => {
    if (extra && !fixes && pending > 0) setQueue((q) => (q ? toFront(q, unfinished(q, started)) : q));
  }, [extra, fixes, pending, started]);

  /** The queue after an answer and the card it shows next (session.ts onward). */
  const ahead = useCallback(
    (q: QueueItem[], begun: ReadonlySet<number> = started) => (session ? onward(q, answered + 1, goal, begun) : { queue: q, shown: q[0] }),
    [session, answered, goal, started],
  );

  /** One more answer in a session; past its goal the stretch runs on only to finish its words. */
  const count = useCallback(() => {
    if (!session) return;
    const n = answered + 1;
    setAnswered(n);
    if (n >= goal + SESSION_MAX - SESSION_TASKS) setOver(true);
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

  /** "Fix mistakes": the mistakes of this stretch, in the order they were made. */
  const startFixes = useCallback(() => {
    logEvent("fix-start", { mistakes: mistakes.map((m) => m.card.korean) });
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
      logOutcome({ rating });
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
      // is heard in a new voice then. In "Learn" that is the mistakes gone over after the stretch.
      if (rating === "again") forgetVoice(item);
      if (rating === "again" && session) setMistakes((m) => withMistake(m, item));
      const { queue: next, shown } = ahead(rating === "again" && !session ? [...queue.slice(1), queue[0]!] : queue.slice(1));
      setQueue(next);
      // Inside the tap, where iOS still lets audio play.
      if (shown?.mode === "listening") speak(heard(shown));
      if (rating !== "again") setDone((n) => n + 1);
      note("reviewed", card.id);
      setRevealed(false);
      setStep((n) => n + 1);
      shownAt.current = performance.now();
      count();
    },
    [item, card, revealed, step, queue, done, speaking, count, note, fixing, fixed, mistakes, session, ahead],
  );

  /** A card said aloud has sent its own rating; the session moves on. */
  const spoken = useCallback(
    (rating: RatingName) => {
      if (!queue) return;
      logOutcome({ rating });
      // A mistake gone over is practice: its card sent nothing.
      if (fixing) return fixed(rating !== "again");
      // Going back over it would rate it twice, so the held rating goes out now.
      setLast(undefined);
      void releaseHeldReview();
      setExit(undefined);
      if (rating === "again") forgetVoice(queue[0]!);
      if (rating === "again" && session) setMistakes((m) => withMistake(m, queue[0]!));
      const { queue: next, shown } = ahead(rating === "again" && !session ? [...queue.slice(1), queue[0]!] : queue.slice(1));
      setQueue(next);
      if (shown?.mode === "listening") speak(heard(shown));
      if (rating !== "again") setDone((n) => n + 1);
      note("reviewed", queue[0]!.card.id);
      setRevealed(false);
      setStep((n) => n + 1);
      shownAt.current = performance.now();
      count();
    },
    [queue, count, note, fixing, fixed, session, ahead],
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
  // Saying aloud turned off for this session ("Can't speak now" on a new word).
  const [silent, setSilent] = useState(false);
  const learned = useCallback(
    (ok: boolean, quiet = false) => {
      if (!queue || !item?.learn) return;
      const logged = logOutcome({ ok, ...(quiet ? { note: "can't speak now" } : {}) });
      // A mistake gone over is practice: the ladder on the server already has the miss.
      if (fixing) return fixed(ok);
      if (!ok) setMistakes((m) => withMistake(m, item));
      setLast(undefined);
      void releaseHeldReview();
      setExit(undefined);
      // "Can't speak now": no more saying aloud in this session.
      if (quiet) setSilent(true);
      const rest = quiet ? queue.slice(1).filter((i) => i.learn?.kind !== "aloud") : queue.slice(1);
      const word = item.card;
      note("met", word.id);
      setStarted((s) => (s.has(word.id) ? s : new Set(s).add(word.id)));
      const kind = item.learn.kind;
      // Built (or met, with nothing to build): the word climbs to typing it, which comes at once, after
      // saying it aloud. Put in now rather than on the server's answer, so it never waits on the network.
      const typeNext = ok && (kind === "build" || (kind === "intro" && !buildable(word)));
      // Meeting a word is followed at once by tasks on it; a missed pick comes back a few cards on.
      const after =
        kind === "intro"
          ? [...afterIntro(word, options[word.id] ?? [], { hear: canSpeak(), say: !silent && canSay(word) }), ...rest]
          : kind === "choose" && !ok
            ? insertAfter([item, ...rest], item).slice(1)
            : rest;
      const { queue: next, shown } = ahead(
        typeNext ? insertNext([item, ...after], learnTask(word, 1, canSpeak())).slice(1) : after,
        started.has(word.id) ? started : new Set(started).add(word.id),
      );
      setQueue(next);
      // Inside the tap, where iOS still lets audio play.
      if (shown?.mode === "listening") speak(heard(shown));
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
            logServer(logged, `${res.status}${"step" in res && res.step !== undefined ? ` step ${res.step}` : ""}`);
            // Typing it is already in the queue.
            if (res.status === "climbed" && res.step === 1 && typeNext) return;
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
          (e: Error) => {
            logServer(logged, `not sent: ${e.message}`);
            if (!isConnectionError(e)) setError(e.message);
          },
        )
        .finally(() => setAnswering((n) => n - 1));
    },
    [queue, item, prepare, count, options, note, silent, fixing, fixed, ahead, started],
  );

  /** "Another round": as many answers again; the same queue goes on, or a fresh one if it ran out. */
  const more = useCallback(() => {
    logEvent("another-round");
    setGoal(answered + SESSION_TASKS);
    setOver(false);
    setStarted(new Set());
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
    logEvent("back", { to: last.queue[0]?.card.korean });
    setQueue(last.queue);
    setDone(last.done);
    setMistakes(last.mistakes);
    setExit(undefined);
    setRevealed(true);
    setStep((n) => n + 1);
    shownAt.current = performance.now();
  }, [last, pause, fixing]);

  // The log: each task as it comes on screen, and the screens between them.
  useEffect(() => {
    if (!item) return;
    const way = item.learn
      ? item.learn.kind
      : building
        ? "build"
        : typing
          ? typing === "sound"
            ? "dictation"
            : "write"
          : item.mode === "speech"
            ? quiet.has(item)
              ? "choice"
              : "say"
            : listening
              ? "listen"
              : cloze
                ? "cloze"
                : "recall";
    logShown(step, item, way, fixing ? "fix" : "main", cloze ? `${cloze.before}[${cloze.word}]${cloze.after}` : undefined);
  }, [step, item]);
  useEffect(() => {
    if (fixIntro) logEvent("fix-intro", { mistakes: mistakes.length });
  }, [fixIntro]);
  useEffect(() => {
    if (summary) {
      logEvent("summary", Object.fromEntries(Object.entries(learnt).map(([k, v]) => [k, [...v].length])));
      void flushLog();
    }
  }, [summary]);

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
  // Past the goal: "15 +2", the steps added to finish the words begun.
  const counted = stretch > SESSION_TASKS ? `${SESSION_TASKS} +${stretch - SESSION_TASKS}` : `${stretch} / ${SESSION_TASKS}`;
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
        <a className="icon-button" href="#/" aria-label={mode === "listening" ? "End listening practice" : "End review"}>
          <CloseIcon />
        </a>
        {/* Held: the session's id for Claude (SessionId.tsx). Taller than the bar, so a thumb finds it. */}
        <div {...longPress} className="progress-hold">
          <div className={`progress${fixing ? " is-fix" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
          </div>
        </div>
        <span className="review-count">
          {session ? (pause ? "" : fixing ? `${right} / ${mistakes.length}` : counted) : mode !== "mixed" || kinds ? `${Math.min(done, total)} / ${total}` : ""}
        </span>
        <button
          type="button"
          className="icon-button review-back"
          aria-label="Bring back the previous card"
          title="Bring back the previous card"
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

      {summary && <SessionDone {...learnt} onMore={more} empty={!queue[0]} press={longPress} />}

      {!session && queue && !card && <Finished count={done} press={longPress} />}

      {showId && <SessionId onClose={() => setShowId(false)} />}

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
            <button type="button" className="link-button inline" onClick={() => {
              logEvent("switched", { to: "say" });
              setQuiet((s) => toggled(s, item));
            }}>
              record your voice
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
            <button type="button" className="link-button inline" onClick={() => {
              logEvent("switched", { to: "choice" });
              setQuiet((s) => toggled(s, item));
            }}>
              Choose from options
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
                aria-label="Listen again"
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
                {listening ? "Listen and recall the translation" : cloze ? "Recall the translation of the highlighted word" : "Recall the translation"}
              </p>
            )}
            {canSpeak() && (!listening || revealed) && (
              <button
                type="button"
                className="icon-button speak-button"
                aria-label="Listen"
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
                Show answer
              </button>
            )}
            <p className="review-tip muted small">
              {revealed ? "Swipe right: Good, left: Again" : last && "Swipe right: bring back the previous one"}
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
  /** `quiet`: the word can't be said now, and nothing more is to be said this session. */
  onDone: (ok: boolean, quiet?: boolean) => void;
}) {
  const kind = item.learn!.kind;
  const { card } = item;
  if (kind === "intro") return <IntroCard card={card} onDone={() => onDone(true)} />;
  if (kind === "choose") return <ChoiceCard item={item} options={options} practice instant onDone={(r) => onDone(r !== "again")} />;
  if (kind === "aloud")
    return (
      <SpeechCard
        item={item}
        recorder={recorder}
        practice
        onRated={(r) => onDone(r !== "again")}
        onCantSpeak={() => onDone(true, true)}
      />
    );
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
        <h1 className="fix-intro-title">Now let's fix the mistakes</h1>
        <p className="finished-text muted">
          {n === 1 ? "One task had a mistake." : `${n} tasks had mistakes.`} Let's go over {n === 1 ? "it" : "them"} again until
          everything is right. This doesn't change the schedule: the mistake already counts.
        </p>
        <ul className="fix-intro-words" aria-label="Words with mistakes">
          {words.map((w, i) => (
            <li key={w.id} lang="ko" style={{ "--i": i } as CSSProperties}>
              {w.korean}
            </li>
          ))}
        </ul>
        <button type="button" className="button primary" onClick={onStart} autoFocus>
          Fix mistakes
        </button>
      </div>
    </div>
  );
}

/** The end of a session's stretch: where its words got to, in words, and "Another round" for another. */
function SessionDone({
  met,
  climbed,
  learned,
  reviewed,
  empty,
  onMore,
  press,
}: Record<"met" | "climbed" | "learned" | "reviewed", ReadonlySet<number>> & { empty: boolean; onMore: () => void; press: LongPress }) {
  // A word checked and learned climbed its ladder in an earlier session; one that climbed now waits.
  const waiting = [...climbed].filter((id) => !learned.has(id)).length;
  const learning = [...met].filter((id) => !climbed.has(id) && !learned.has(id)).length;
  const rows = (
    [
      ["learned", learned.size, "learned", one(learned.size, "passed the check and is now in reviews", "passed the check and are now in reviews")],
      [
        "climbed",
        waiting,
        "almost learned",
        one(
          waiting,
          "went through every step. I'll ask again in 3 hours, and then it's learned",
          "went through every step. I'll ask again in 3 hours, and then they're learned",
        ),
      ],
      ["learning", learning, "in progress", "the next round picks up from the same step"],
      ["reviewed", reviewed.size, "reviewed", "already learned, now fresh again"],
    ] as const
  ).filter(([, n]) => n > 0);
  return (
    <div className="review-stage">
      <div className="finished session-done">
        <p {...press} className="finished-mark press-hold" lang="ko">
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
            ? "Nothing more to learn or review right now. You can add new words any time."
            : "You can stop here or do another round."}
        </p>
        <div className="session-done-actions">
          {!empty && (
            <button type="button" className="button primary" onClick={onMore}>
              Another round
            </button>
          )}
          <a className={`button${empty ? " primary" : ""}`} href="#/">
            Home
          </a>
        </div>
      </div>
    </div>
  );
}

/** Singular for one word, plural otherwise. */
function one(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
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
          {tone === "good" ? "Good" : tone === "again" ? "Again" : "Back"}
        </span>
        {children}
      </div>
    </div>
  );
}

function Finished({ count, press }: { count: number; press: LongPress }) {
  return (
    <div className="review-stage">
      <div className="finished">
        <p {...press} className="finished-mark press-hold" lang="ko">
          잘했어요!
        </p>
        <p className="finished-text">
          {count ? `Cards reviewed: ${count}. That's all for today.` : "Nothing to review right now."}
        </p>
        <a className="button primary" href="#/">
          Home
        </a>
      </div>
    </div>
  );
}
