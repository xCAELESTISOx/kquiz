import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { grammarApi, type GrammarAnswerInput } from "../lib/api";
import {
  buildTiles,
  checkTyped,
  chooseOptions,
  classOf,
  formationRows,
  planSession,
  pointsToStart,
  sentenceParts,
  sentenceText,
  understandOptions,
  whyWrong,
  type GrammarPoint,
  type GrammarTask,
  type Outcome,
} from "../lib/grammar";
import { CloseIcon } from "../ui/icons";
import "../ui/learn.css";
import "../ui/phrase.css";
import "../ui/practice.css";
import "../ui/grammar.css";

/** Answers arrive slower than this count as "a bit slow" (soft). */
const SLOW_MS = 25_000;

export function GrammarScreen() {
  const [points, setPoints] = useState<GrammarPoint[]>();
  const [tasks, setTasks] = useState<GrammarTask[]>();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  const missed = useRef<GrammarTask[]>([]);
  const fixing = useRef(false);
  const [right, setRight] = useState(0);

  useEffect(() => {
    document.title = "Grammar · KQuiz";
    let live = true;
    (async () => {
      let { points } = await grammarApi.list();
      const start = pointsToStart(points);
      for (const p of start) await grammarApi.startLearning(p.id).catch(() => undefined);
      if (start.length) points = (await grammarApi.list()).points;
      if (!live) return;
      setPoints(points);
      setTasks(planSession(points));
    })().catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  const task = tasks?.[step];

  const done = useCallback(
    (outcome: Outcome | "seen", elapsedMs: number) => {
      if (!tasks || !task) return;
      let next = tasks;
      if (outcome !== "seen" && task.kind !== "intro") {
        const answer: GrammarAnswerInput = {
          id: crypto.randomUUID(),
          pointId: task.point.id,
          sentenceId: task.sentence.id,
          task: task.kind,
          phase: task.phase,
          outcome,
          ...(classOf(task.sentence.slot) ? { cls: classOf(task.sentence.slot) } : {}),
          answeredAt: new Date().toISOString(),
          elapsedMs,
        };
        grammarApi.answer([answer]).catch((e: Error) => setError(e.message));
        if (outcome === "right") setRight((n) => n + 1);
        if (outcome === "wrong" && task.phase !== "fix") {
          missed.current.push({ ...task, phase: "fix" });
          // A miss on the ladder takes it one step down; the rest of its ladder waits for the next session.
          if (task.phase === "learn") next = tasks.filter((t, i) => i <= step || !(t.point.id === task.point.id && t.phase === "learn"));
        }
      }
      // Mistakes come back once at the end, with the same task on another reading of the sentence.
      if (step + 1 >= next.length && missed.current.length && !fixing.current) {
        fixing.current = true;
        next = [...next, ...missed.current];
      }
      setTasks(next);
      setStep(step + 1);
    },
    [tasks, task, step],
  );

  const total = tasks?.length ?? 0;
  const others = points ?? [];

  return (
    <main className="review grammar">
      <header className="review-top">
        <a className="icon-button" href="#/" aria-label="Finish">
          <CloseIcon />
        </a>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={step}>
          <div className="progress-fill" style={{ transform: `scaleX(${total ? Math.min(step / total, 1) : 0})` }} />
        </div>
        <span className="review-count">
          {Math.min(step, total)} / {total}
        </span>
      </header>

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      {!tasks && !error && <div className="review-stage" aria-busy="true" />}
      {tasks && !task && <Finished points={points ?? []} answered={tasks.filter((t) => t.kind !== "intro").length} right={right} />}
      {task && <TaskView key={step} task={task} others={others} onDone={done} />}
    </main>
  );
}

function TaskView({ task, others, onDone }: { task: GrammarTask; others: GrammarPoint[]; onDone: (o: Outcome | "seen", ms: number) => void }) {
  const started = useRef(Date.now());
  const finish = useCallback(
    (o: Outcome | "seen") => {
      const ms = Date.now() - started.current;
      onDone(o === "right" && ms > SLOW_MS ? "soft" : o, ms);
    },
    [onDone],
  );
  switch (task.kind) {
    case "intro":
      return <Intro point={task.point} onDone={() => finish("seen")} />;
    case "understand":
      return <Understand task={task} others={others} onDone={finish} />;
    case "choose":
      return <Choose task={task} others={others} onDone={finish} />;
    case "build":
      return <Build task={task} onDone={finish} />;
    case "type":
      return <Type task={task} onDone={finish} />;
  }
}

const KICKER: Record<GrammarTask["phase"], string> = { learn: "New grammar", check: "Check", review: "Review", fix: "Going over mistakes" };

function Kicker({ task }: { task: GrammarTask }) {
  return (
    <p className="grammar-kicker">
      <span>{KICKER[task.phase]}</span>
      <span lang="ko">{task.point.pattern}</span>
    </p>
  );
}

/** The sentence with the form marked, or a gap where it goes. */
function Sentence({ task, gap, mark = true }: { task: GrammarTask; gap?: boolean; mark?: boolean }) {
  const { before, form, after } = sentenceParts(task.sentence);
  return (
    <p className="grammar-sentence" lang="ko">
      {before}
      {gap ? <span className="cloze-gap" aria-label="gap" /> : form && mark ? <mark className="cloze-mark">{form}</mark> : form}
      {after}
    </p>
  );
}

function Intro({ point, onDone }: { point: GrammarPoint; onDone: () => void }) {
  const rows = useMemo(() => formationRows(point), [point]);
  const examples = point.sentences.slice(0, 2);
  return (
    <>
      <div className="review-stage">
        <div className="review-card grammar-card grammar-intro">
          <p className="grammar-kicker">
            <span>New grammar</span>
          </p>
          <p className="grammar-pattern" lang="ko">
            {point.pattern}
          </p>
          <p className="review-meaning">{point.meaning}</p>
          {point.explanation && <p className="grammar-explanation">{point.explanation}</p>}
          {rows.length > 0 && (
            <table className="grammar-table">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.lemma}>
                    <td lang="ko">{r.lemma}</td>
                    <td lang="ko" className="grammar-table-form">
                      {r.form}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.some((r) => r.rule) && (
            <ul className="grammar-rules">
              {[...new Set(rows.map((r) => r.rule).filter(Boolean))].map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <div className="grammar-examples">
            {examples.map((s) => (
              <div key={s.id}>
                <p lang="ko">{sentenceText(s)}</p>
                <p className="muted">{s.translation}</p>
              </div>
            ))}
          </div>
          {point.trap && <p className="grammar-trap">{point.trap}</p>}
          {point.similar.length > 0 && (
            <p className="grammar-similar muted">
              Don't confuse:{" "}
              {point.similar.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ", "}
                  <span lang="ko">{s.pattern}</span>
                  {s.note && ` — ${s.note}`}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
      <footer className="review-actions">
        <button type="button" className="button primary" onClick={onDone}>
          Got it
        </button>
        <p className="review-tip muted small">Read the examples aloud once</p>
      </footer>
    </>
  );
}

function Feedback({ ok, children }: { ok: boolean; children?: React.ReactNode }) {
  if (!children) return null;
  return <p className={`sounds-feedback grammar-feedback tone-${ok ? "ok" : "wrong"}`}>{children}</p>;
}

function Understand({ task, others, onDone }: { task: GrammarTask; others: GrammarPoint[]; onDone: (o: Outcome) => void }) {
  const options = useMemo(() => understandOptions(task.point, others), [task, others]);
  const [picked, setPicked] = useState<number>();
  const answered = picked !== undefined;
  const ok = answered && picked >= 0 && options[picked]!.right;
  // With nothing to tell it from yet, the task just shows the sentence and its sense.
  const lone = options.length < 2;
  return (
    <>
      <div className="review-stage">
        <div className="review-card grammar-card" data-result={answered ? (ok ? "right" : "wrong") : undefined}>
          <Kicker task={task} />
          <p className="speech-ask">What does the marked part say?</p>
          <Sentence task={task} />
          {(answered || lone) && <p className="muted grammar-translation">{task.sentence.translation}</p>}
        </div>
      </div>
      <div aria-live="polite">{answered && !ok && <Feedback ok={false}>It's {task.point.meaning}</Feedback>}</div>
      <footer className="review-actions">
        {lone ? (
          <button type="button" className="button primary" onClick={() => onDone("right")}>
            Next
          </button>
        ) : (
          <>
            <div className="grammar-options">
              {options.map((o, i) => (
                <button
                  key={o.meaning}
                  type="button"
                  className="grammar-option"
                  disabled={answered}
                  data-state={!answered ? undefined : o.right ? "right" : i === picked ? "wrong" : "other"}
                  style={{ "--i": i } as CSSProperties}
                  onClick={() => setPicked(i)}
                >
                  {o.meaning}
                </button>
              ))}
            </div>
            {answered ? (
              <button type="button" className="button primary" onClick={() => onDone(ok ? "right" : "wrong")}>
                Next
              </button>
            ) : (
              <button type="button" className="chip-button dont-know" onClick={() => setPicked(-1)}>
                Don't know
              </button>
            )}
          </>
        )}
      </footer>
    </>
  );
}

function Hint({ task }: { task: GrammarTask }) {
  const slot = task.sentence.slot!;
  return (
    <p className="grammar-hint">
      <span lang="ko">{slot.lemma}</span>
      <span aria-hidden="true">+</span>
      <span lang="ko">{slot.pattern}</span>
    </p>
  );
}

function Choose({ task, others, onDone }: { task: GrammarTask; others: GrammarPoint[]; onDone: (o: Outcome) => void }) {
  const options = useMemo(() => chooseOptions(task.sentence, task.point, others), [task, others]);
  const [picked, setPicked] = useState<number>();
  const answered = picked !== undefined;
  const ok = answered && picked >= 0 && options[picked]!.right;
  const why = answered && !ok && picked >= 0 ? whyWrong(task.sentence.slot!, options[picked]!.form) : undefined;
  return (
    <>
      <div className="review-stage">
        <div className="review-card grammar-card" data-result={answered ? (ok ? "right" : "wrong") : undefined}>
          <Kicker task={task} />
          <p className="speech-ask">Pick the form</p>
          <Sentence task={task} gap={!answered} />
          <p className="muted grammar-translation">{task.sentence.translation}</p>
          <Hint task={task} />
        </div>
      </div>
      <div aria-live="polite">{answered && !ok && <Feedback ok={false}>{why ?? "Here's the right form"}</Feedback>}</div>
      <footer className="review-actions">
        <div className="grammar-options">
          {options.map((o, i) => (
            <button
              key={o.form}
              type="button"
              className="grammar-option"
              lang="ko"
              disabled={answered}
              data-state={!answered ? undefined : o.right ? "right" : i === picked ? "wrong" : "other"}
              style={{ "--i": i } as CSSProperties}
              onClick={() => setPicked(i)}
            >
              {o.form}
            </button>
          ))}
        </div>
        {answered ? (
          <button type="button" className="button primary" onClick={() => onDone(ok ? "right" : "wrong")}>
            Next
          </button>
        ) : (
          <button type="button" className="chip-button dont-know" onClick={() => setPicked(-1)}>
            Don't know
          </button>
        )}
      </footer>
    </>
  );
}

function Build({ task, onDone }: { task: GrammarTask; onDone: (o: Outcome) => void }) {
  const { answer, bank } = useMemo(() => buildTiles(task.sentence), [task]);
  const [placed, setPlaced] = useState<number[]>([]);
  const [result, setResult] = useState<boolean>();
  const built = placed.map((i) => bank[i]!);
  const complete = placed.length === answer.length;
  useEffect(() => {
    if (complete && result === undefined) setResult(built.join(" ") === answer.join(" "));
  }, [complete, result, built, answer]);
  return (
    <>
      <div className="review-stage">
        <div className="review-card phrase-card grammar-card" data-result={result === undefined ? undefined : result ? "right" : "wrong"}>
          <Kicker task={task} />
          <p className="speech-ask">Build it in Korean</p>
          <p className="speech-meaning phrase-prompt">{task.sentence.translation}</p>
          <div className="phrase-line" lang="ko" aria-label="Your sentence">
            {answer.map((word, i) => {
              const at = placed[i];
              if (at === undefined) return <span key={`gap-${i}`} className="phrase-gap" aria-hidden="true" />;
              const state = result === undefined ? undefined : bank[at] === word ? "right" : "wrong";
              return (
                <button
                  key={`chip-${i}`}
                  type="button"
                  className="phrase-chip"
                  data-state={state}
                  disabled={result !== undefined}
                  onClick={() => setPlaced(placed.filter((_, j) => j !== i))}
                >
                  {bank[at]}
                </button>
              );
            })}
          </div>
          {result === false && (
            <div className="phrase-answer">
              <p className="phrase-correct" lang="ko">
                {answer.join(" ")}
              </p>
            </div>
          )}
        </div>
      </div>
      <div aria-live="polite">{result === false && task.sentence.slot && <Feedback ok={false}>{whyWrong(task.sentence.slot, built.join(" ")) ?? "Here's the sentence"}</Feedback>}</div>
      <footer className="review-actions phrase-actions">
        {result !== undefined ? (
          <button type="button" className="button primary" onClick={() => onDone(result ? "right" : "wrong")}>
            Next
          </button>
        ) : (
          <>
            <div className="phrase-bank" lang="ko">
              {bank.map((tile, i) => (
                <button key={i} type="button" className="phrase-tile" disabled={placed.includes(i)} onClick={() => setPlaced([...placed, i])}>
                  {tile}
                </button>
              ))}
            </div>
            <div className="phrase-buttons">
              <button type="button" className="chip-button dont-know" onClick={() => setResult(false)}>
                Don't know
              </button>
            </div>
          </>
        )}
      </footer>
    </>
  );
}

function Type({ task, onDone }: { task: GrammarTask; onDone: (o: Outcome) => void }) {
  const slot = task.sentence.slot!;
  const [text, setText] = useState("");
  const [result, setResult] = useState<"right" | "spacing" | "wrong">();
  const [nudge, setNudge] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const ok = result === "right" || result === "spacing";
  function submit(e: FormEvent) {
    e.preventDefault();
    if (result) return onDone(result === "right" && !nudge ? "right" : ok ? "soft" : "wrong");
    const r = checkTyped(text, slot);
    // The same form in another style isn't a mistake: ask for it in this sentence's style.
    if (r === "style" && !nudge) {
      setNudge(true);
      return;
    }
    setResult(r === "style" ? "wrong" : r);
  }
  const why = result === "wrong" && text.trim() ? whyWrong(slot, text) : undefined;
  const style = slot.final.style ?? "formal";
  return (
    <>
      <div className="review-stage">
        <div className="review-card grammar-card" data-result={result ? (ok ? "right" : "wrong") : undefined}>
          <Kicker task={task} />
          <p className="speech-ask">Type the form</p>
          <Sentence task={task} gap={!result} />
          <p className="muted grammar-translation">{task.sentence.translation}</p>
          <Hint task={task} />
        </div>
      </div>
      <div aria-live="polite">
        {nudge && !result && <Feedback ok>Right form, now in the {style === "formal" ? "합니다" : style === "polite" ? "해요" : "plain"} style</Feedback>}
        {result === "spacing" && <Feedback ok>Mind the spaces</Feedback>}
        {result === "wrong" && <Feedback ok={false}>{why ?? (text.trim() ? "Here's the right form" : "Here's how it goes")}</Feedback>}
      </div>
      <form className="review-actions type-actions" onSubmit={submit}>
        <input
          ref={input}
          className={`input input-korean type-input${result ? (ok ? " is-right" : " is-wrong") : ""}`}
          lang="ko"
          inputMode="text"
          enterKeyHint={result ? "next" : "done"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="The form in Korean"
          placeholder="한글로"
          readOnly={!!result}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {result ? (
          <button type="submit" className="button primary">
            Next
          </button>
        ) : (
          <>
            <button type="submit" className="button primary" disabled={!text.trim()}>
              Check
            </button>
            <button type="button" className="chip-button dont-know" onClick={() => setResult("wrong")}>
              Don't know
            </button>
          </>
        )}
      </form>
    </>
  );
}

function Finished({ points, answered, right }: { points: GrammarPoint[]; answered: number; right: number }) {
  const waiting = points.filter((p) => p.status === "pool").length;
  return (
    <div className="review-stage">
      <div className="finished">
        <p className="finished-mark" lang="ko">
          잘했어요!
        </p>
        <p className="finished-text">
          {answered
            ? `Grammar tasks: ${answered}, right first time: ${right}.`
            : points.length
              ? "Nothing to go over right now. Constructions up the ladder are checked a few hours later."
              : "No grammar yet. Ask Claude to add the constructions from your lesson."}
          {waiting > 0 && ` ${waiting} more waiting to be learned.`}
        </p>
        <a className="button primary" href="#/">
          Home
        </a>
      </div>
    </div>
  );
}
