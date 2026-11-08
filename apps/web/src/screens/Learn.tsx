import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "../lib/api";
import {
  buildTiles,
  GROUP_SIZE,
  groupReinforce,
  groupSteps,
  requeue,
  type LearnAbilities,
  type LearnStep,
} from "../lib/learn";
import { phrasesWord, wordsWord } from "../lib/plural";
import { canRecord, type Recorder } from "../lib/recorder";
import { canSpeak, preloadSpeech, speak } from "../lib/speech";
import type { Card, ChoiceOption, GroupFilter, PhraseTiles, QueueItem, RatingName } from "../lib/types";
import { CloseIcon, SpeakerIcon } from "../ui/icons";
import { HiddenTranslation } from "../ui/HiddenTranslation";
import { SimilarList } from "../ui/Similar";
import { useFamily, WordFamily } from "../ui/WordFamily";
import { PhraseCard } from "./Phrase";
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
  phrase: "Собери фразу",
  "phrase-ear": "Фраза на слух",
};

const abilities = (card: Card): LearnAbilities => ({
  hear: canSpeak(),
  say: canRecord() && card.kind === "word" && card.speakable && card.readyForSpeech,
});

/** Where the close button goes: the card, or the list the group was picked from. */
function backHash(id: number | undefined, group: GroupFilter | undefined): string {
  if (id !== undefined) return `#/cards/${id}`;
  const path = group?.status === "queued" ? "#/cards/queued" : group?.kind === "phrase" ? "#/cards/phrases" : "#/cards";
  return group?.root ? `${path}?root=${encodeURIComponent(group.root)}` : path;
}

/**
 * "Учить": one word from a card's menu, or a group picked on the cards screen, GROUP_SIZE words at a
 * time, taken from meeting them to producing them (lib/learn.ts). Phrases are built from their blocks.
 * No rating is sent: the stats stay as they were. New words (not yet in reviews) enter reviews once
 * their portion has been gone through: the next day, or later today the ones missed on the way.
 */
export function LearnScreen({ id, group }: { id?: number; group?: GroupFilter }) {
  // The whole group, and where the portion being learned starts in it.
  const [all, setAll] = useState<Card[]>();
  const [from, setFrom] = useState(0);
  const [options, setOptions] = useState<Record<number, ChoiceOption[]>>({});
  const [tiles, setTiles] = useState<Record<number, PhraseTiles>>({});
  const [ready, setReady] = useState(false);
  const [queue, setQueue] = useState<LearnStep[]>([]);
  const [total, setTotal] = useState(0);
  const [missed, setMissed] = useState<ReadonlySet<number>>(new Set());
  // Words with a step missed this pass; "Закрепить" goes over them.
  const [shaky, setShaky] = useState<ReadonlySet<number>>(new Set());
  // Steps that ask something; meeting the word is not one.
  const [asked, setAsked] = useState(0);
  const [pass, setPass] = useState(0);
  const [shown, setShown] = useState(0);
  const [error, setError] = useState<string>();
  // New words of this portion taken into reviews when it was finished.
  const [learned, setLearned] = useState<number[]>();
  const recorder = useRef<Recorder>(undefined);
  const back = backHash(id, group);
  const single = id !== undefined;

  const cards = useMemo(() => all?.slice(from, from + GROUP_SIZE) ?? [], [all, from]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const begin = useCallback((steps: LearnStep[]) => {
    setMissed(new Set());
    setShaky(new Set());
    setQueue(steps);
    setTotal(steps.length);
    setAsked(steps.filter((s) => s.kind !== "intro").length);
    setShown((n) => n + 1);
  }, []);

  useEffect(() => {
    document.title = "Учить · KQuiz";
    (id !== undefined
      ? api.card(id).then(({ card }) => [card])
      : api
          .cards({ ...group, limit: 200 })
          .then(({ cards }) => cards.filter((c) => !c.suspended))
    ).then(setAll, (e: Error) => setError(e.message === "not_found" ? "Такой карточки нет. Может, её уже удалили." : e.message));
    // A new group is a new screen (App keys it).
  }, [id]);

  // Each portion: look-alikes for the decoys, blocks for the phrases, the recordings ahead of time.
  useEffect(() => {
    if (!cards.length) return;
    setReady(false);
    const words = cards.filter((c) => c.kind !== "phrase").map((c) => c.id);
    const phrases = cards.filter((c) => c.kind === "phrase").map((c) => c.id);
    for (const card of cards) preloadSpeech(card);
    Promise.all([
      words.length ? api.choices(words).catch(() => ({ options: {} })) : { options: {} },
      phrases.length ? api.blocks(phrases).catch(() => ({ tiles: {} })) : { tiles: {} },
    ]).then(([{ options }, { tiles }]) => {
      setOptions(options);
      setTiles(tiles);
      setPass(0);
      begin(groupSteps(cards, abilities));
      setReady(true);
    });
  }, [cards, begin]);

  useEffect(() => () => recorder.current?.close(), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") location.hash = back.slice(1);
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [back]);

  const current = ready ? queue[0] : undefined;
  const card = current && byId.get(current.cardId);

  const done = useCallback(
    (ok: boolean) => {
      if (!current) return;
      if (!ok) {
        setMissed((m) => new Set(m).add(current.id));
        setShaky((m) => new Set(m).add(current.cardId));
      }
      const rest = queue.slice(1);
      // In a group a few other words come between, so it isn't answered from the screen just seen.
      const next = ok ? rest : requeue(rest, current.first ? { ...current, first: false } : current, single ? 1 : 3);
      setQueue(next);
      setShown((n) => n + 1);
      // Inside the tap, where iOS still lets audio play.
      const heard = next[0] && (next[0].kind === "dictation" || next[0].kind === "phrase-ear") && byId.get(next[0].cardId);
      if (heard) speak(heard);
    },
    [current, queue, byId, single],
  );

  const again = useCallback(() => {
    const over = cards.filter((c) => shaky.has(c.id));
    const steps = groupReinforce(over.length ? over : cards, abilities, pass + 1);
    setPass((p) => p + 1);
    begin(steps);
    const first = steps[0] && byId.get(steps[0].cardId);
    if (first && (steps[0]!.kind === "dictation" || steps[0]!.kind === "phrase-ear")) speak(first);
  }, [cards, shaky, pass, begin, byId]);

  // Steps still to go, a missed one counted once.
  const left = new Set(queue.map((s) => s.id)).size;
  const progress = total ? (total - left) / total : 0;
  const item: QueueItem | undefined = card && {
    card,
    mode: current.kind === "dictation" || current.kind === "phrase-ear" ? "listening" : current.kind === "phrase" ? "meaning" : "speech",
    due: "",
    state: 0,
    reps: current.first ? 0 : 1,
    lapses: 0,
  };
  const next = all?.slice(from + GROUP_SIZE, from + 2 * GROUP_SIZE) ?? [];
  const finished = ready && !current && total > 0;

  // The first time through a portion, its new words go into reviews; "Закрепить" changes nothing.
  useEffect(() => {
    if (!finished || pass !== 0 || learned) return;
    const fresh = cards.filter((c) => c.queued).map((c) => c.id);
    setLearned([]);
    if (!fresh.length) return;
    api.learned(fresh, fresh.filter((cardId) => shaky.has(cardId))).then(
      ({ introduced }) => setLearned(introduced),
      (e: Error) => setError(`Не получилось отправить слова в повторение: ${e.message}`),
    );
  }, [finished, pass, learned, cards, shaky]);

  return (
    <main className="review learn">
      <header className="review-top">
        <a className="icon-button" href={back} aria-label={single ? "Вернуться к карточке" : "Вернуться к карточкам"}>
          <CloseIcon />
        </a>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={1} aria-valuenow={progress}>
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="review-count learn-step">{current ? TITLES[current.kind] : ""}</span>
      </header>

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      {!ready && !error && all?.length !== 0 && <div className="review-stage" aria-busy="true" />}

      {all?.length === 0 && (
        <div className="review-stage">
          <div className="finished">
            <p className="finished-text">В этой группе нечего учить: все карточки на паузе.</p>
            <a className="button" href={back}>
              К карточкам
            </a>
          </div>
        </div>
      )}

      {card && current?.kind === "intro" && <IntroCard key={shown} card={card} onDone={() => done(true)} />}
      {card && current?.kind === "build" && <BuildCard key={shown} card={card} options={options[card.id] ?? []} onDone={done} />}
      {item && (current?.kind === "dictation" || current?.kind === "write" || current?.kind === "cloze") && (
        <TypeCard
          key={shown}
          item={item}
          ask={current?.kind === "dictation" ? "sound" : current?.kind === "write" ? "meaning" : "cloze"}
          cloze={current?.cloze}
          practice
          onDone={(rating: RatingName) => done(rating === "good")}
        />
      )}
      {item && current?.kind === "aloud" && (
        <SpeechCard key={shown} item={item} recorder={recorder} practice onRated={(rating) => done(rating !== "again")} />
      )}
      {item && (current?.kind === "phrase" || current?.kind === "phrase-ear") && (
        <PhraseCard
          key={shown}
          item={item}
          tiles={tiles[item.card.id]}
          ask={current?.kind === "phrase-ear" ? "sound" : "meaning"}
          practice
          onDone={(rating) => done(rating !== "again")}
        />
      )}

      {finished && (
        <div className="review-stage">
          <div className="finished">
            {cards.length === 1 ? (
              <p className="finished-mark" lang="ko">
                {cards[0]!.korean}
              </p>
            ) : (
              <ul className="learn-summary" lang="ko" aria-label="Слова этой порции">
                {cards.map((c, i) => (
                  <li key={c.id} className="learn-summary-word" data-shaky={shaky.has(c.id) || undefined} style={{ "--i": i } as CSSProperties}>
                    {c.korean}
                  </li>
                ))}
              </ul>
            )}
            <p className="finished-text">
              {missed.size === 0 ? "Всё с первого раза." : `С первого раза: ${asked - missed.size} из ${asked}.`}
              {shaky.size > 0 && cards.length > 1 && " Отмечены слова, где были ошибки."}{" "}
              {learned?.length
                ? learned.length === cards.length
                  ? `${cards.length === 1 ? "Слово придёт" : "Слова придут"} в повторение завтра${shaky.size > 0 ? ", с ошибками — ещё сегодня" : ""}.`
                  : `Новые слова (${learned.length}) придут в повторение завтра${shaky.size > 0 ? ", с ошибками — ещё сегодня" : ""}.`
                : `Статистика не изменилась, ${cards.length === 1 ? "слово придёт" : "слова придут"} в повторение как обычно.`}
            </p>
            <button type="button" className="button primary" onClick={again}>
              {shaky.size > 0 && shaky.size < cards.length ? "Закрепить трудные" : "Закрепить"}
            </button>
            {next.length > 0 && (
              <button
                type="button"
                className="button"
                onClick={() => {
                  setLearned(undefined);
                  setFrom((f) => f + GROUP_SIZE);
                }}
              >
                Учить ещё {next.length} {next.every((c) => c.kind === "phrase") ? phrasesWord(next.length) : wordsWord(next.length)}
              </button>
            )}
            <a className="button" href={back}>
              {single ? "К карточке" : "К карточкам"}
            </a>
          </div>
        </div>
      )}
    </main>
  );
}

/** The whole card at once, heard first: the word is met before anything is asked about it. */
export function IntroCard({ card, onDone }: { card: Card; onDone: () => void }) {
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
              <HiddenTranslation text={example.ru} />
            </div>
          )}
          {card.notes && <p className="review-notes muted">{card.notes}</p>}
          <SimilarList card={card} />
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
export function BuildCard({ card, options, onDone }: { card: Card; options: ChoiceOption[]; onDone: (ok: boolean) => void }) {
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
