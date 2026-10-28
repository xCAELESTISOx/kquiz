import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { buildRound, play, practice, preload, stopPlayback, textAudioUrl, type Drill, type Trial } from "../lib/practice";
import { navigate } from "../lib/router";
import { CloseIcon } from "../ui/icons";
import { EarIcon } from "../ui/practiceIcons";
import "../ui/practice.css";

/** Listening drill: one word of a set of similar ones plays, you pick which it was. */
export function SoundsScreen() {
  const [drills, setDrills] = useState<Drill[]>();
  const [round, setRound] = useState<Trial[]>([]);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<number>();
  const [right, setRight] = useState(0);
  // Options open once the word has been heard, so a guess is never blind.
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    practice.drills().then(
      ({ drills }) => {
        setDrills(drills);
        setRound(buildRound(drills));
        setStep(0);
        setRight(0);
        setPicked(undefined);
        setHeard(false);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(() => {
    document.title = "Похожие звуки · KQuiz";
    load();
    return stopPlayback;
  }, [load]);

  const trial = round[step];
  const finished = drills !== undefined && step >= round.length;

  useEffect(() => {
    for (const t of round.slice(step, step + 2)) for (const w of t.drill.words) preload(textAudioUrl(w.korean, t.voice));
  }, [round, step]);

  const listen = useCallback((text: string, voice?: string) => {
    void play(textAudioUrl(text, voice)).then((ok) => !ok && setError("Не получилось проиграть звук. Попробуй ещё раз."));
  }, []);

  const listenTarget = useCallback(() => {
    if (!trial) return;
    setHeard(true);
    listen(trial.drill.words[trial.target]!.korean, trial.voice);
  }, [trial, listen]);

  const pick = useCallback(
    (i: number) => {
      if (!trial) return;
      if (picked !== undefined) {
        // After the answer every word can be played to compare.
        listen(trial.drill.words[i]!.korean, trial.voice);
        return;
      }
      const correct = i === trial.target;
      setPicked(i);
      if (correct) setRight((n) => n + 1);
      void practice.answer(trial.drill.id, correct).catch(() => {});
    },
    [trial, picked, listen],
  );

  const next = useCallback(() => {
    const following = round[step + 1];
    setStep((s) => s + 1);
    setPicked(undefined);
    setError(undefined);
    // Still inside the tap, so iOS lets the next word play right away.
    setHeard(!!following);
    if (following) listen(following.drill.words[following.target]!.korean, following.voice);
  }, [round, step, listen]);

  const remove = useCallback(() => {
    if (!trial) return;
    const id = trial.drill.id;
    void practice.deleteDrill(id).then(() => {
      const rest = (drills ?? []).filter((d) => d.id !== id);
      setDrills(rest);
      setRound((r) => [...r.slice(0, step + 1), ...buildRound(rest).slice(0, r.length - step - 1)]);
    });
  }, [trial, drills, step]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") navigate("today");
      else if (!trial) return;
      else if (e.key === " " && !e.repeat) {
        e.preventDefault();
        listenTarget();
      } else if (heard && /^[1-4]$/.test(e.key) && Number(e.key) <= trial.drill.words.length) pick(Number(e.key) - 1);
      else if (e.key === "Enter" && picked !== undefined) next();
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [trial, picked, heard, pick, next, listenTarget]);

  const waiting = useMemo(() => (drills ?? []).filter((d) => !d.ready).length, [drills]);
  const answered = Math.min(step + (picked !== undefined ? 1 : 0), round.length);
  const progress = round.length ? answered / round.length : 0;

  return (
    <main className="review sounds">
      <header className="review-top">
        <a className="icon-button" href="#/" aria-label="Закончить">
          <CloseIcon />
        </a>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={round.length} aria-valuenow={answered}>
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="review-count">
          {answered} / {round.length}
        </span>
      </header>

      {!drills && !error && <div className="review-stage" aria-busy="true" />}

      {drills && round.length === 0 && <NoDrills waiting={waiting} />}

      {finished && round.length > 0 && <RoundDone right={right} total={round.length} onAgain={load} />}

      {trial && (
        <>
          <div className="review-stage">
            <div className="review-card sounds-card" key={step}>
              <p className="speech-ask">Какое слово звучит?</p>
              <p className="sounds-contrast" lang="ko">
                {trial.drill.contrast.split("/").join(" · ")}
              </p>
              <button
                type="button"
                className="sounds-play"
                aria-label="Послушать ещё раз"
                data-pulse={!heard || undefined}
                onClick={listenTarget}
              >
                <EarIcon />
              </button>
              <p className="muted small">{heard ? "Нажми, чтобы повторить" : "Нажми, чтобы услышать"}</p>
            </div>
          </div>

          <div aria-live="polite">
            {error && <p className="notice notice-error speech-notice">{error}</p>}
            {picked !== undefined && (
              <p className={`sounds-feedback tone-${picked === trial.target ? "ok" : "wrong"}`}>
                {picked === trial.target ? "Верно" : `Это было ${trial.drill.words[trial.target]!.korean}`}
              </p>
            )}
          </div>

          <footer className="review-actions">
            <div className="sounds-options" data-count={trial.drill.words.length}>
              {trial.drill.words.map((w, i) => {
                const state =
                  picked === undefined ? undefined : i === trial.target ? "right" : i === picked ? "wrong" : "other";
                return (
                  <button
                    key={w.korean}
                    type="button"
                    className="sounds-option"
                    data-state={state}
                    disabled={!heard && picked === undefined}
                    style={{ "--i": i } as CSSProperties}
                    onClick={() => pick(i)}
                  >
                    <span className="sounds-option-word" lang="ko">
                      {w.korean}
                    </span>
                    {w.meaning && <span className="sounds-option-meaning">{w.meaning}</span>}
                  </button>
                );
              })}
            </div>
            {picked !== undefined ? (
              <>
                <button type="button" className="button primary" onClick={next}>
                  {step + 1 < round.length ? "Дальше" : "Итог"}
                </button>
                <p className="review-tip muted small">
                  Нажимай на слова, чтобы сравнить.{" "}
                  <button type="button" className="link-button" onClick={remove}>
                    Убрать этот набор
                  </button>
                </p>
              </>
            ) : (
              <>
                {heard && (
                  <button type="button" className="chip-button dont-know" onClick={() => pick(-1)}>
                    Не знаю
                  </button>
                )}
                <p className="review-tip muted small">{heard ? "Выбери, что услышал" : "Сначала послушай"}</p>
              </>
            )}
          </footer>
        </>
      )}
    </main>
  );
}

function NoDrills({ waiting }: { waiting: number }) {
  return (
    <div className="review-stage">
      <div className="finished">
        <p className="finished-mark" lang="ko">
          ㄱ ㅋ ㄲ
        </p>
        <p className="finished-text">
          {waiting
            ? `Наборов: ${waiting}. Сервер их ещё озвучивает, загляни чуть позже.`
            : "Наборов пока нет. Попроси Claude: «Добавь в KQuiz упражнения на звуки, которые я путаю». Он подберёт слова из твоих карточек."}
        </p>
        <a className="button primary" href="#/">
          На главную
        </a>
      </div>
    </div>
  );
}

function RoundDone({ right, total, onAgain }: { right: number; total: number; onAgain: () => void }) {
  return (
    <div className="review-stage">
      <div className="finished">
        <p className="finished-mark">
          {right} <span className="muted">из {total}</span>
        </p>
        <p className="finished-text">
          {right === total
            ? "Всё на слух верно."
            : right >= total * 0.75
              ? "Почти всё. Наборы с ошибками придут первыми в следующий раз."
              : "Эти звуки пока сливаются. Наборы с ошибками придут первыми в следующий раз."}
        </p>
        <button type="button" className="button primary" onClick={onAgain}>
          Ещё раунд
        </button>
        <a className="button" href="#/">
          На главную
        </a>
      </div>
    </div>
  );
}
