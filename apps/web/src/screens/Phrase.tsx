import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { submitReview } from "../lib/api";
import { useLeechIds } from "../lib/leeches";
import { bank, buildRating, checkBuild, fallbackTiles, trailingPunctuation, type SlotState, type Tile } from "../lib/phrase";
import { canSpeak, speak } from "../lib/speech";
import type { PhraseTiles, QueueItem, RatingName } from "../lib/types";
import { SpeakerIcon } from "../ui/icons";
import { LeechBadge } from "../ui/LeechBadge";
import { PhraseParts, RegisterBadge } from "../ui/PhraseParts";
import "../ui/learn.css";
import "../ui/phrase.css";

/** From its translation (the meaning schedule) or by ear (listening). */
export type BuildAsk = "meaning" | "sound";

/**
 * A phrase put together from its blocks, with wrong ones mixed in: look-alikes with another particle
 * or ending, and blocks of other phrases. A phrase met for the first time is shown whole before it is
 * asked. Sends its rating as soon as it is checked; "Дальше" tells the session.
 */
export function PhraseCard({
  item,
  tiles,
  ask,
  onDone,
}: {
  item: QueueItem;
  tiles: PhraseTiles | undefined;
  ask: BuildAsk;
  onDone: (rating: RatingName) => void;
}) {
  const { card } = item;
  const set = useMemo(() => tiles ?? fallbackTiles(card), [tiles, card]);
  const deck = useMemo(() => bank(set), [set]);
  const [stage, setStage] = useState<"intro" | "build">(ask === "meaning" && item.reps === 0 ? "intro" : "build");
  const [picked, setPicked] = useState<Tile[]>([]);
  const [result, setResult] = useState<{ slots: SlotState[]; rating: RatingName; gaveUp: boolean }>();
  const [error, setError] = useState<string>();
  const startedAt = useRef(performance.now());
  const leeches = useLeechIds(item.mode);
  const full = picked.length === set.blocks.length;
  const end = trailingPunctuation(card.korean);

  useEffect(() => {
    // A new phrase is heard as it is met. One asked by ear is played by the session, inside the tap
    // that brought it, where iOS still lets audio play.
    if (canSpeak() && stage === "intro") speak(card);
  }, [stage, card]);

  const start = useCallback(() => {
    setStage("build");
    startedAt.current = performance.now();
  }, []);

  const check = useCallback(
    (gaveUp = false) => {
      if (result) return;
      const slots = checkBuild(
        set.blocks,
        picked.map((t) => t.text),
      );
      const correct = !gaveUp && slots.every((s) => s === "right");
      const elapsedMs = Math.round(performance.now() - startedAt.current);
      const rating = buildRating(correct, elapsedMs, set.blocks.length);
      setResult({ slots: gaveUp ? set.blocks.map(() => "wrong") : slots, rating, gaveUp });
      if (canSpeak()) speak(card);
      void submitReview({
        id: crypto.randomUUID(),
        cardId: card.id,
        mode: item.mode,
        rating,
        reviewedAt: new Date().toISOString(),
        elapsedMs,
      }).catch((e: Error) => setError(e.message));
    },
    [result, set, picked, card, item.mode],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (stage === "intro") start();
        else if (result) onDone(result.rating);
        else if (full) check();
      } else if (e.key === "Backspace" && !result && picked.length) {
        e.stopPropagation();
        setPicked((p) => p.slice(0, -1));
      }
    }
    // Capture, so Backspace takes back a block before the review screen takes back a card.
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [stage, result, full, picked, check, start, onDone]);

  if (stage === "intro") {
    return (
      <>
        <div className="review-stage">
          <div className="review-card phrase-card">
            <p className="phrase-kicker">Новая фраза</p>
            <p className="phrase-whole" lang="ko">
              {card.korean}
            </p>
            {card.pronunciation && card.pronunciation !== card.korean && (
              <p className="review-pron">
                <span lang="ko">[{card.pronunciation}]</span>
              </p>
            )}
            <p className="review-meaning">{card.meaning}</p>
            <RegisterBadge card={card} />
            <PhraseParts card={card} />
            {card.notes && <p className="review-notes muted">{card.notes}</p>}
            {canSpeak() && (
              <button type="button" className="icon-button speak-button" aria-label="Послушать" onClick={() => speak(card)}>
                <SpeakerIcon />
              </button>
            )}
          </div>
        </div>
        <footer className="review-actions">
          <button type="button" className="button primary" onClick={start}>
            Собрать её
          </button>
          <p className="review-tip muted small">Послушай пару раз и повтори вслух</p>
        </footer>
      </>
    );
  }

  const correct = result && !result.gaveUp && result.slots.every((s) => s === "right");

  return (
    <>
      <div className="review-stage">
        <div className="review-card phrase-card" data-result={result ? (correct ? "right" : "wrong") : undefined}>
          {leeches.has(card.id) && <LeechBadge />}
          <p className="speech-ask">{ask === "sound" ? "Собери, что слышишь" : "Собери фразу по-корейски"}</p>
          {ask === "sound" ? (
            !result && (
              <button type="button" className="listen-play" aria-label="Послушать ещё раз" onClick={() => speak(card)}>
                <SpeakerIcon />
              </button>
            )
          ) : (
            <p className="speech-meaning phrase-prompt">{card.meaning}</p>
          )}

          <div className="phrase-line" lang="ko" aria-label="Собранная фраза">
            {set.blocks.map((_, i) => {
              const tile = picked[i];
              const state = result?.slots[i];
              if (!tile)
                return <span key={`gap-${i}`} className="phrase-gap" data-state={state} aria-hidden="true" />;
              return (
                <button
                  key={tile.id}
                  type="button"
                  className="phrase-chip"
                  data-state={state}
                  disabled={!!result}
                  aria-label={`убрать ${tile.text}`}
                  onClick={() => setPicked((p) => p.filter((t) => t.id !== tile.id))}
                >
                  {tile.text}
                </button>
              );
            })}
            {end && <span className="phrase-end">{end}</span>}
          </div>

          {result && (
            <div className="phrase-answer">
              {!correct && (
                <p className="phrase-correct" lang="ko">
                  {card.korean}
                </p>
              )}
              {ask === "sound" && <p className="review-meaning">{card.meaning}</p>}
              <RegisterBadge card={card} />
              <PhraseParts card={card} />
              {card.notes && <p className="review-notes muted">{card.notes}</p>}
              {canSpeak() && (
                <button type="button" className="icon-button speak-button" aria-label="Послушать фразу" onClick={() => speak(card)}>
                  <SpeakerIcon />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div aria-live="polite">
        {error && <p className="notice notice-error speech-notice">{error}</p>}
        {result && (
          <p className={`sounds-feedback tone-${correct ? "ok" : "wrong"}`}>
            {correct ? (result.rating === "hard" ? "Верно, но не сразу" : "Верно") : result.gaveUp ? "Вот как правильно" : "Не так, правильно выше"}
          </p>
        )}
      </div>

      <footer className="review-actions phrase-actions">
        {result ? (
          <button type="button" className="button primary" onClick={() => onDone(result.rating)}>
            Дальше
          </button>
        ) : (
          <>
            <div className="phrase-bank" lang="ko">
              {deck.map((tile, i) => (
                <button
                  key={tile.id}
                  type="button"
                  className="phrase-tile"
                  style={{ "--i": i } as CSSProperties}
                  disabled={full || picked.some((t) => t.id === tile.id)}
                  onClick={() => setPicked((p) => (p.length < set.blocks.length ? [...p, tile] : p))}
                >
                  {tile.text}
                </button>
              ))}
            </div>
            <div className="phrase-buttons">
              <button type="button" className="chip-button dont-know" onClick={() => check(true)}>
                Не знаю
              </button>
              <button type="button" className="button primary" disabled={!full} onClick={() => check()}>
                Проверить
              </button>
            </div>
          </>
        )}
      </footer>
    </>
  );
}
