import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { submitReview } from "../lib/api";
import type { Cloze } from "../lib/cloze";
import { useLeechIds } from "../lib/leeches";
import { canSpeak, speak } from "../lib/speech";
import { afterNudge, similarAnswer } from "../lib/similar";
import { heard } from "../lib/voices";
import { logAnswer } from "../lib/sessionLog";
import type { QueueItem, RatingName, SimilarWord } from "../lib/types";
import { checkTyped, joinMarks, typingRating, wrongKeyboard, type TypingCheck } from "../lib/typing";
import { HiddenTranslation } from "../ui/HiddenTranslation";
import { LeechBadge } from "../ui/LeechBadge";
import { SimilarList, SimilarNudge } from "../ui/Similar";
import { SpeakerIcon } from "../ui/icons";
import "../ui/learn.css";

/** By its sound (the listening schedule), by its translation (speech), or into an example. */
export type TypeAsk = "sound" | "meaning" | "cloze";

const ASK: Record<TypeAsk, string> = {
  sound: "Type what you hear",
  meaning: "Type it in Korean",
  cloze: "Type the word as in the sentence",
};

const HINT_AFTER_MS = 5000;

/**
 * The word typed in Hangul and checked letter by letter. Sends its rating to the item's schedule as
 * soon as it is checked, unless practising; "Next" tells the session. With a cloze, the answer is
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
  // The similar word typed instead (휴지통 for 쓰레기통): said so, and the answer asked for again.
  const [nudge, setNudge] = useState<SimilarWord>();
  const nudged = useRef(false);
  const rate = useCallback((result: TypingCheck) => afterNudge(typingRating(result), nudged.current), []);

  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  // Five seconds without the answer from the translation: its sound is offered as a hint.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (ask !== "meaning" || !canSpeak()) return;
    const timer = setTimeout(() => setStuck(true), HINT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [ask]);

  const finish = useCallback(
    (typed: string) => {
      if (check) return;
      const similar = ask === "meaning" ? similarAnswer(card, typed) : undefined;
      if (similar) {
        logAnswer({ given: typed, expected, note: `similar word ${similar.korean}, asked again` });
        nudged.current = true;
        setNudge(similar);
        setText("");
        input.current?.focus({ preventScroll: true });
        return;
      }
      const result = checkTyped(expected, typed);
      logAnswer({ given: typed, expected, ok: result.correct, ...(result.almost ? { note: `almost: ${result.slips.join(", ")}` } : {}) });
      setCheck(result);
      input.current?.blur();
      if (canSpeak()) speak(heard(item));
      if (!practice)
        void submitReview({
          id: crypto.randomUUID(),
          cardId: card.id,
          mode: item.mode,
          rating: rate(result),
          reviewedAt: new Date().toISOString(),
          elapsedMs: Math.round(performance.now() - shownAt.current),
        }).catch((e: Error) => setError(e.message));
    },
    [check, expected, card, item, practice, ask, rate],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (check) onDone(rate(check));
    else if (text.trim()) finish(text);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (check && (e.key === "Enter" || e.key === " ") && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        onDone(rate(check));
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [check, onDone, rate]);

  const latin = !check && wrongKeyboard(text);

  return (
    <>
      <div className="review-stage">
        <div className="review-card type-card">
          {leeches.has(card.id) && <LeechBadge />}
          <p className="speech-ask">{ASK[ask]}</p>
          {ask === "sound" && (
            <button type="button" className="listen-play" aria-label="Listen again" onClick={() => speak(heard(item))}>
              <SpeakerIcon />
            </button>
          )}
          {ask === "meaning" && <p className="speech-meaning">{card.meaning}</p>}
          {ask === "meaning" && stuck && !check && (
            <button type="button" className="chip-button type-hint" onClick={() => speak(heard(item))}>
              <SpeakerIcon />
              Listen
            </button>
          )}
          {nudge && !check && <SimilarNudge key={nudge.id} word={nudge} />}
          {ask === "cloze" && cloze && (
            <div className="speech-context type-context">
              <p lang="ko">
                {cloze.before}
                {check ? <mark className="cloze-mark">{cloze.word}</mark> : <span className="cloze-gap" aria-label="gap" />}
                {cloze.after}
              </p>
              <HiddenTranslation text={card.examples[cloze.example]!.ru} />
            </div>
          )}
          {check && (
            <div className="type-answer">
              <p className="type-word" lang="ko" aria-label={expected}>
                {joinMarks(check.marks).map((m, i) => (
                  <span key={i} className={`type-mark is-${m.status}`}>
                    {m.text}
                  </span>
                ))}
              </p>
              {ask !== "meaning" && <p className="type-meaning">{card.meaning}</p>}
              {canSpeak() && ask !== "sound" && (
                <button type="button" className="icon-button speak-button" aria-label="Listen to the word" onClick={() => speak(heard(item))}>
                  <SpeakerIcon />
                </button>
              )}
              {nudge && <SimilarList card={card} />}
            </div>
          )}
        </div>
      </div>

      <div aria-live="polite">
        {error && <p className="notice notice-error speech-notice">{error}</p>}
        {check && (
          <p className={`sounds-feedback tone-${check.correct ? "ok" : "wrong"}`}>
            {feedback(check, text, nudged.current)}
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
          aria-label="The word in Korean"
          placeholder="한글로"
          readOnly={!!check}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {latin && <p className="review-tip muted small">Switch to a Korean keyboard</p>}
        {check ? (
          <button type="submit" className="button primary">
            Next
          </button>
        ) : (
          <>
            <button type="submit" className="button primary" disabled={!text.trim()}>
              Check
            </button>
            <button type="button" className="chip-button dont-know" onClick={() => finish("")}>
              Don't know
            </button>
          </>
        )}
      </form>
    </>
  );
}

/** Letter by letter only while the answer was close; a different word is just shown right. */
function feedback(check: TypingCheck, typed: string, nudged: boolean): string {
  if (check.correct) return nudged ? "Correct, with a hint" : "Correct";
  if (check.almost) return `Almost: ${check.slips[0]}`;
  if (!typed.trim()) return "Here's how it's spelled";
  const close = check.marks.filter((m) => m.status === "ok").length >= check.marks.length / 2;
  return close ? check.slips.slice(0, 2).join(", ") : "A different word, here's the right one";
}
