import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { isKoreanOnly, parseBulk } from "../lib/korean";
import { cardsWord } from "../lib/plural";
import type { AddCardsResult, NewCard } from "../lib/types";
import { CheckIcon } from "../ui/icons";
import { Spinner } from "../ui/Spinner";

// Autofocus only with a mouse: on iPhone it shifts the layout without opening the keyboard.
const finePointer = typeof matchMedia !== "undefined" && matchMedia("(pointer: fine)").matches;

type Mode = "single" | "bulk";

const MODE_KEY = "kquiz.addMode";

export function AddScreen() {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) === "bulk" ? "bulk" : "single"));

  useEffect(() => {
    document.title = "Добавить · KQuiz";
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <h1 className="title">추가</h1>
        <p className="subtitle">Новая карточка</p>
      </header>

      <div className="segmented" role="tablist" aria-label="Способ добавления">
        <button type="button" role="tab" aria-selected={mode === "single"} onClick={() => switchMode("single")}>
          Одна
        </button>
        <button type="button" role="tab" aria-selected={mode === "bulk"} onClick={() => switchMode("bulk")}>
          Списком
        </button>
      </div>

      {mode === "single" ? <SingleForm /> : <BulkForm />}
    </main>
  );
}

function SingleForm() {
  const [korean, setKorean] = useState("");
  const [meaning, setMeaning] = useState("");
  const [more, setMore] = useState(false);
  const [exampleKo, setExampleKo] = useState("");
  const [exampleMeaning, setExampleMeaning] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<{ korean?: string; meaning?: string }>({});
  const [added, setAdded] = useState<NewCard[]>([]);
  const koreanRef = useRef<HTMLInputElement>(null);
  const meaningRef = useRef<HTMLInputElement>(null);

  const notSpeakable = korean.trim() !== "" && !isKoreanOnly(korean.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const errors = {
      ...(!korean.trim() && { korean: "Впиши слово по-корейски" }),
      ...(!meaning.trim() && { meaning: "Впиши перевод" }),
    };
    setFieldErrors(errors);
    if (errors.korean) return koreanRef.current?.focus();
    if (errors.meaning) return meaningRef.current?.focus();
    const card: NewCard = {
      korean: korean.trim(),
      meaning: meaning.trim(),
      ...(exampleKo.trim() && { exampleKo: exampleKo.trim() }),
      ...(exampleMeaning.trim() && { exampleMeaning: exampleMeaning.trim() }),
      ...(notes.trim() && { notes: notes.trim() }),
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.addCard(card);
      if (result.status === "created") {
        setAdded((list) => [card, ...list].slice(0, 5));
        setKorean("");
        setMeaning("");
        setExampleKo("");
        setExampleMeaning("");
        setNotes("");
        koreanRef.current?.focus();
      } else {
        setError(`«${card.korean}» уже есть в карточках`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label className="field">
        <span className="field-label">По-корейски</span>
        <input
          ref={koreanRef}
          className="input input-korean"
          lang="ko"
          autoFocus={finePointer}
          name="korean"
          aria-invalid={!!fieldErrors.korean}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="next"
          placeholder="예: 바다…"
          value={korean}
          onChange={(e) => {
            setKorean(e.target.value);
            setFieldErrors((f) => ({ ...f, korean: undefined }));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              meaningRef.current?.focus();
            }
          }}
        />
        {fieldErrors.korean ? (
          <span className="field-error">{fieldErrors.korean}</span>
        ) : (
          notSpeakable && <span className="field-hint">Не только хангыль: в тренировку произношения не попадёт</span>
        )}
      </label>

      <label className="field">
        <span className="field-label">Перевод</span>
        <input
          ref={meaningRef}
          className="input"
          lang="ru"
          autoComplete="off"
          enterKeyHint="done"
          name="meaning"
          aria-invalid={!!fieldErrors.meaning}
          placeholder="например: море…"
          value={meaning}
          onChange={(e) => {
            setMeaning(e.target.value);
            setFieldErrors((f) => ({ ...f, meaning: undefined }));
          }}
        />
        {fieldErrors.meaning && <span className="field-error">{fieldErrors.meaning}</span>}
      </label>

      {more ? (
        <>
          <label className="field">
            <span className="field-label">Пример</span>
            <input
              className="input"
              lang="ko"
              autoComplete="off"
              value={exampleKo}
              onChange={(e) => setExampleKo(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Перевод примера</span>
            <input
              className="input"
              autoComplete="off"
              value={exampleMeaning}
              onChange={(e) => setExampleMeaning(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Заметка</span>
            <textarea className="input textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Теги через запятую</span>
            <input
              className="input"
              autoComplete="off"
              autoCapitalize="off"
              placeholder="еда, глаголы…"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
        </>
      ) : (
        <button type="button" className="link-button" onClick={() => setMore(true)}>
          Пример, заметка, теги
        </button>
      )}

      <p className="muted small">Произношение и романизация заполнятся сами.</p>

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      {added.length > 0 && (
        <ul className="added-list" aria-label="Только что добавлены">
          {added.map((card) => (
            <li key={card.korean} className="added-item">
              <CheckIcon />
              <span lang="ko" className="added-korean">
                {card.korean}
              </span>
              <span className="muted">{card.meaning}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="bottom-actions">
        <button className="button primary" type="submit" disabled={busy}>
          {busy && <Spinner />}
          Добавить карточку
        </button>
      </div>
    </form>
  );
}

function BulkForm() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AddCardsResult>();

  const lines = useMemo(() => parseBulk(text), [text]);
  const cards = lines.flatMap((l) => (l.card ? [l.card] : []));
  const bad = lines.filter((l) => l.error);

  async function submit() {
    if (busy) return;
    if (!cards.length) {
      setError(lines.length ? "Ни одна строка не разобралась. Поправь их по подсказкам ниже." : "Вставь слова, по одному на строку.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.addCards(cards);
      setResult(res);
      // Keep only the lines that need fixing in the box.
      setText(bad.map((l) => l.raw).join("\n"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <label className="field">
        <span className="field-label">Одна карточка на строку</span>
        <textarea
          className="input textarea textarea-bulk"
          lang="ko"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={"물 — вода\n불 — огонь\n하늘 — небо…"}
          value={text}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          onChange={(e) => {
            setText(e.target.value);
            setResult(undefined);
            setError(undefined);
          }}
        />
        <span className="field-hint muted">Разделитель: тире, дефис с пробелами или табуляция</span>
      </label>

      {result && (
        <div className="notice notice-ok" role="status" aria-live="polite">
          Добавлено: {result.created.length}
          {result.duplicates.length > 0 && <>. Уже были: {result.duplicates.map((d) => d.korean).join(", ")}</>}
          {result.rejected.length > 0 && <>. Не приняты: {result.rejected.map((r) => r.input).join(", ")}</>}
        </div>
      )}

      {lines.length > 0 && (
        <ul className="preview-list" aria-label="Предпросмотр">
          {lines.map((l) =>
            l.card ? (
              <li key={l.line} className="preview-item">
                <span lang="ko" className="preview-korean">
                  {l.card.korean}
                </span>
                <span className="preview-meaning">{l.card.meaning}</span>
              </li>
            ) : (
              <li key={l.line} className="preview-item preview-bad">
                <span className="preview-raw">{l.raw}</span>
                <span className="preview-error">
                  строка {l.line}: {l.error}
                </span>
              </li>
            ),
          )}
        </ul>
      )}

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      <div className="bottom-actions">
        <button className="button primary" type="button" disabled={busy} onClick={submit}>
          {busy && <Spinner />}
          {cards.length ? `Добавить ${cards.length} ${cardsWord(cards.length)}` : "Добавить карточки"}
        </button>
      </div>
    </div>
  );
}
