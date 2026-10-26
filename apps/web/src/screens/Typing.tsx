import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { submitReview } from "../lib/api";
import type { Cloze } from "../lib/cloze";
import { useLeechIds } from "../lib/leeches";
import { canSpeak, speak } from "../lib/speech";
import type { QueueItem, RatingName } from "../lib/types";
import { checkTyped, typingRating, wrongKeyboard, type TypingCheck } from "../lib/typing";
import { LeechBadge } from "../ui/LeechBadge";
import { SpeakerIcon } from "../ui/icons";
import "../ui/learn.css";

/** By its sound (the listening schedule), by its translation (speech), or into an example. */
export type TypeAsk = "sound" | "meaning" | "cloze";

const ASK: Record<TypeAsk, string> = {
  sound: "Напиши, что слышишь",
  meaning: "Напиши по-корейски",
  cloze: "Впиши слово, как в предложении",
};

/**
 * The word typed in Hangul and checked letter by letter. Sends its rating to the item's schedule as
 * soon as it is checked, unless practising; "Дальше" tells the session. With a cloze, the answer is
 * the word as it stands in that sentence (먹어요, not 먹다).
 */
export function TypeCard({
  item,
  ask,
  cloze,
  onDone,
  practice,
}: {
  item: QueueItem;
  ask: TypeAsk;
  cloze?: Cloze;
  onDone: (rating: RatingName) => void;
  practice?: boolean;
}) {
  const { card } = item;
  const [text, setText] = useState("");
  const [check, setCheck] = useState<TypingCheck>();
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const shownAt = useRef(performance.now());
  const leeches = useLeechIds(item.mode);
  const expected = ask === "cloze" && cloze ? cloze.word : card.korean;

  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  const finish = useCallback(
    (typed: string) => {
      if (check) return;
      const result = checkTyped(expected, typed);
      setCheck(result);
      input.current?.blur();
      if (canSpeak()) speak(card);
      if (!practice)
        void submitReview({
          id: crypto.randomUUID(),
          cardId: card.id,
          mode: item.mode,
          rating: typingRating(result),
          reviewedAt: new Date().toISOString(),
          elapsedMs: Math.round(performance.now() - shownAt.current),
        }).catch((e: Error) => setError(e.message));
    },
    [check, expected, card, item.mode, practice],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (check) onDone(typingRating(check));
    else if (text.trim()) finish(text);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (check && (e.key === "Enter" || e.key === " ") && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        onDone(typingRating(check));
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [check, onDone]);

  const latin = !check && wrongKeyboard(text);

  return (
    <>
      <div className="review-stage">
        <div className="review-card type-card">
          {leeches.has(card.id) && <LeechBadge />}
          <p className="speech-ask">{ASK[ask]}</p>
          {ask === "sound" && (
            <button type="button" className="listen-play" aria-label="Послушать ещё раз" onClick={() => speak(card)}>
              <SpeakerIcon />
            </button>
          )}
          {ask === "meaning" && <p className="speech-meaning">{card.meaning}</p>}
          {ask === "cloze" && cloze && (
            <div className="speech-context type-context">
              <p lang="ko">
                {cloze.before}
                {check ? <mark className="cloze-mark">{cloze.word}</mark> : <span className="cloze-gap" aria-label="пропуск" />}
                {cloze.after}
              </p>
              <p className="muted">{card.examples[cloze.example]!.ru}</p>
            </div>
          )}
          {check && (
            <div className="type-answer">
              <p className="type-word" lang="ko" aria-label={expected}>
                {check.marks.map((m, i) => (
                  <span key={i} className={`type-mark is-${m.status}`}>
                    {m.text}
                  </span>
                ))}
              </p>
              {ask !== "meaning" && <p className="type-meaning">{card.meaning}</p>}
              {canSpeak() && ask !== "sound" && (
                <button type="button" className="icon-button speak-button" aria-label="Послушать слово" onClick={() => speak(card)}>
                  <SpeakerIcon />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div aria-live="polite">
        {error && <p className="notice notice-error speech-notice">{error}</p>}
        {check && (
          <p className={`sounds-feedback tone-${check.correct ? "ok" : "wrong"}`}>
            {feedback(check, text)}
          </p>
        )}
      </div>

      <form className="review-actions type-actions" onSubmit={submit}>
        <input
          ref={input}
          className={`input input-korean type-input${check ? (check.correct ? " is-right" : " is-wrong") : ""}`}
          lang="ko"
          inputMode="text"
          enterKeyHint={check ? "next" : "done"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="Слово по-корейски"
          placeholder="한글로"
          readOnly={!!check}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {latin && <p className="review-tip muted small">Включи корейскую раскладку</p>}
        {check ? (
          <button type="submit" className="button primary">
            Дальше
          </button>
        ) : (
          <>
            <button type="submit" className="button primary" disabled={!text.trim()}>
              Проверить
            </button>
            <button type="button" className="chip-button dont-know" onClick={() => finish("")}>
              Не знаю
            </button>
          </>
        )}
      </form>
    </>
  );
}

/** Letter by letter only while the answer was close; a different word is just shown right. */
function feedback(check: TypingCheck, typed: string): string {
  if (check.correct) return "Верно";
  if (check.almost) return `Почти: ${check.slips[0]}`;
  if (!typed.trim()) return "Вот как пишется";
  const close = check.marks.filter((m) => m.status === "ok").length >= check.marks.length / 2;
  return close ? check.slips.slice(0, 2).join(", ") : "Другое слово, вот как правильно";
}
