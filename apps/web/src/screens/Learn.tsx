import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "../lib/api";
import { buildTiles, learnSteps, reinforceSteps, requeue, type LearnAbilities, type LearnStep } from "../lib/learn";
import { canRecord, type Recorder } from "../lib/recorder";
import { canSpeak, preloadSpeech, speak } from "../lib/speech";
import type { Card, ChoiceOption, QueueItem, RatingName } from "../lib/types";
import { CloseIcon, SpeakerIcon } from "../ui/icons";
import { useFamily, WordFamily } from "../ui/WordFamily";
import { SpeechCard } from "./Speech";
import { TypeCard } from "./Typing";
import "../ui/learn.css";

const TITLES: Record<LearnStep["kind"], string> = {
  intro: "Знакомство",
  build: "Собери из слогов",
  dictation: "По звуку",
  write: "По переводу",
  cloze: "В примере",
  aloud: "Вслух",
};

/**
 * "Учить" from a card's menu: one word, from meeting it to producing it (lib/learn.ts). Nothing is
 * sent anywhere: the word's schedule and the stats stay as they were, and it comes up in reviews as
 * before.
 */
export function LearnScreen({ id }: { id: number }) {
  const [card, setCard] = useState<Card>();
  const [options, setOptions] = useState<ChoiceOption[]>([]);
  const [queue, setQueue] = useState<LearnStep[]>([]);
  const [total, setTotal] = useState(0);
  const [missed, setMissed] = useState<ReadonlySet<number>>(new Set());
  // Steps that ask something; meeting the word is not one.
  const [asked, setAsked] = useState(0);
  const [pass, setPass] = useState(0);
  const [shown, setShown] = useState(0);
  const [error, setError] = useState<string>();
  const recorder = useRef<Recorder>(undefined);
  const back = `#/cards/${id}`;

  const can: LearnAbilities | undefined = useMemo(
    () => card && { hear: canSpeak(), say: canRecord() && card.speakable && card.readyForSpeech },
    [card],
  );

  useEffect(() => {
    document.title = "Учить · KQuiz";
    Promise.all([api.card(id), api.choices([id]).catch(() => ({ options: {} as Record<number, ChoiceOption[]> }))]).then(
      ([{ card }, { options }]) => {
        setCard(card);
        setOptions(options[id] ?? []);
        preloadSpeech(card);
        const steps = learnSteps(card, { hear: canSpeak(), say: canRecord() && card.speakable && card.readyForSpeech });
        setQueue(steps);
        setTotal(steps.length);
        setAsked(steps.filter((s) => s.kind !== "intro").length);
      },
      (e: Error) => setError(e.message === "not_found" ? "Такой карточки нет. Может, её уже удалили." : e.message),
    );
  }, [id]);

  useEffect(() => () => recorder.current?.close(), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") location.hash = back.slice(1);
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [back]);

  const current = queue[0];

  const done = useCallback(
    (ok: boolean) => {
      if (!current) return;
      if (!ok) setMissed((m) => new Set(m).add(current.id));
      const rest = queue.slice(1);
      const next = ok ? rest : requeue(rest, current);
      setQueue(next);
      setShown((n) => n + 1);
      // Inside the tap, where iOS still lets audio play.
      if (next[0]?.kind === "dictation" && card) speak(card);
    },
    [current, queue, card],
  );

  const again = useCallback(() => {
    if (!card || !can) return;
    const steps = reinforceSteps(card, can, pass + 1);
    setPass((p) => p + 1);
    setMissed(new Set());
    setQueue(steps);
    setTotal(steps.length);
    setAsked(steps.length);
    setShown((n) => n + 1);
    if (steps[0]?.kind === "dictation") speak(card);
  }, [card, can, pass]);

  // Steps still to go, a missed one counted once.
  const left = new Set(queue.map((s) => s.id)).size;
  const progress = total ? (total - left) / total : 0;
  const item: QueueItem | undefined = card && { card, mode: current?.kind === "dictation" ? "listening" : "speech", due: "", state: 0, reps: 0, lapses: 0 };

  return (
    <main className="review learn">
      <header className="review-top">
        <a className="icon-button" href={back} aria-label="Вернуться к карточке">
          <CloseIcon />
        </a>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={1} aria-valuenow={progress}>
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="review-count learn-step">{current ? TITLES[current.kind] : ""}</span>
      </header>

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      {!card && !error && <div className="review-stage" aria-busy="true" />}

      {card && item && current?.kind === "intro" && <IntroCard key={shown} card={card} onDone={() => done(true)} />}
      {card && current?.kind === "build" && (
        <BuildCard key={shown} card={card} options={options} onDone={done} />
      )}
      {item && (current?.kind === "dictation" || current?.kind === "write" || current?.kind === "cloze") && (
        <TypeCard
          key={shown}
          item={item}
          ask={current.kind === "dictation" ? "sound" : current.kind === "write" ? "meaning" : "cloze"}
          cloze={current.cloze}
          practice
          onDone={(rating: RatingName) => done(rating === "good")}
        />
      )}
      {item && current?.kind === "aloud" && (
        <SpeechCard key={shown} item={item} recorder={recorder} practice onRated={(rating) => done(rating !== "again")} />
      )}

      {card && !current && total > 0 && (
        <div className="review-stage">
          <div className="finished">
            <p className="finished-mark" lang="ko">
              {card.korean}
            </p>
            <p className="finished-text">
              {missed.size === 0 ? "Всё с первого раза." : `С первого раза: ${asked - missed.size} из ${asked}.`} Расписание и статистика
              не изменились, слово придёт в повторение как обычно.
            </p>
            <button type="button" className="button primary" onClick={again}>
              Закрепить
            </button>
            <a className="button" href={back}>
              К карточке
            </a>
          </div>
        </div>
      )}
    </main>
  );
}

/** The whole card at once, heard first: the word is met before anything is asked about it. */
function IntroCard({ card, onDone }: { card: Card; onDone: () => void }) {
  const families = useFamily(card);
  useEffect(() => {
    if (canSpeak()) speak(card);
  }, [card]);
  const example = card.examples[0];
  return (
    <>
      <div className="review-stage">
        <div className="review-card intro-card">
          <p className="intro-word" lang="ko">
            {card.korean}
          </p>
          {((card.pronunciation && card.pronunciation !== card.korean) || card.romanization) && (
            <p className="review-pron">
              {card.pronunciation && card.pronunciation !== card.korean && <span lang="ko">[{card.pronunciation}]</span>}
              {card.romanization && <span className="muted">{card.romanization}</span>}
            </p>
          )}
          <p className="review-meaning">{card.meaning}</p>
          <WordFamily card={card} families={families} />
          {example && (
            <div className="intro-example">
              <p lang="ko">{example.ko}</p>
              <p className="muted">{example.ru}</p>
            </div>
          )}
          {card.notes && <p className="review-notes muted">{card.notes}</p>}
          {canSpeak() && (
            <button type="button" className="icon-button speak-button" aria-label="Послушать" onClick={() => speak(card)}>
              <SpeakerIcon />
            </button>
          )}
        </div>
      </div>
      <footer className="review-actions">
        <button type="button" className="button primary" onClick={onDone}>
          Запомнил, дальше
        </button>
        <p className="review-tip muted small">Послушай пару раз и прочитай пример вслух</p>
      </footer>
    </>
  );
}

/** The word put together from its syllables and a few decoys, by its translation and sound. */
function BuildCard({ card, options, onDone }: { card: Card; options: ChoiceOption[]; onDone: (ok: boolean) => void }) {
  const tiles = useMemo(() => buildTiles(card, options), [card, options]);
  const answer = useMemo(() => [...card.korean.replace(/\s/g, "")], [card]);
  // Indexes into `tiles`, in the order tapped.
  const [picked, setPicked] = useState<number[]>([]);
  const full = picked.length === answer.length;
  const right = full && picked.every((t, i) => tiles[t] === answer[i]);

  useEffect(() => {
    if (full && canSpeak()) speak(card);
  }, [full, card]);

  function tap(index: number) {
    if (full || picked.includes(index)) return;
    setPicked((p) => [...p, index]);
  }

  return (
    <>
      <div className="review-stage">
        <div className="review-card build-card">
          <p className="speech-ask">Собери слово</p>
          <p className="speech-meaning">{card.meaning}</p>
          {canSpeak() && (
            <button type="button" className="icon-button speak-button" aria-label="Послушать" onClick={() => speak(card)}>
              <SpeakerIcon />
            </button>
          )}
          <div className="build-slots" lang="ko" aria-label="Собранное слово">
            {answer.map((s, i) => {
              const t = picked[i];
              const state = !full ? undefined : tiles[t!] === s ? "right" : "wrong";
              return (
                <button
                  key={i}
                  type="button"
                  className="build-slot"
                  data-state={state}
                  disabled={full || t === undefined}
                  aria-label={t === undefined ? "пусто" : `убрать ${tiles[t]}`}
                  onClick={() => setPicked((p) => p.slice(0, i))}
                >
                  {t !== undefined && tiles[t]}
                </button>
              );
            })}
          </div>
          {full && !right && (
            <p className="type-word build-correct" lang="ko">
              {card.korean}
            </p>
          )}
        </div>
      </div>

      <div aria-live="polite">
        {full && <p className={`sounds-feedback tone-${right ? "ok" : "wrong"}`}>{right ? "Верно" : "Правильно так"}</p>}
      </div>

      <footer className="review-actions">
        {full ? (
          <button type="button" className="button primary" onClick={() => onDone(right)}>
            Дальше
          </button>
        ) : (
          <div className="build-tiles" lang="ko">
            {tiles.map((s, i) => (
              <button
                key={i}
                type="button"
                className="build-tile"
                style={{ "--i": i } as CSSProperties}
                disabled={picked.includes(i)}
                onClick={() => tap(i)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </footer>
    </>
  );
}
