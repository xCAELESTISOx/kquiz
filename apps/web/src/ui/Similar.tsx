import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import type { Card, SimilarWord } from "../lib/types";
import { CloseIcon } from "./icons";
import { Spinner } from "./Spinner";
import "./similar.css";

/** The pair sign: two near shapes, not the same. */
function PairMark() {
  return (
    <svg className="similar-mark" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="9" cy="12" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="15" cy="12" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2.2" />
    </svg>
  );
}

/**
 * Shown instead of a mistake when the linked word was given: which word that was, what tells the two
 * apart, and a nudge to give the other one.
 */
export function SimilarNudge({ word }: { word: SimilarWord }) {
  return (
    <div className="similar-nudge" role="status">
      <p className="similar-nudge-head">
        <PairMark />
        <span>
          <span lang="ko" className="similar-nudge-word">
            {word.korean}
          </span>{" "}
          — это «{word.meaning}»
        </span>
      </p>
      {word.note && <p className="similar-nudge-note">{word.note}</p>}
      <p className="similar-nudge-ask">Похожее слово, но здесь нужно другое</p>
    </div>
  );
}

/** On the answer side of a card: the words not to mix it up with. */
export function SimilarList({ card }: { card: Card }) {
  if (!card.similar?.length) return null;
  return (
    <section className="similar-list" aria-label="Похожие слова">
      {card.similar.map((w) => (
        <div key={w.id} className="similar-item">
          <p className="similar-line">
            <span className="similar-ne" aria-label="не путать с">
              ≠
            </span>
            <span lang="ko" className="similar-word">
              {w.korean}
            </span>
            <span className="similar-meaning">{w.meaning}</span>
          </p>
          {w.note && <p className="similar-note">{w.note}</p>}
        </div>
      ))}
    </section>
  );
}

const ERRORS: Record<string, string> = {
  too_many: "У слова может быть не больше 8 похожих",
  not_found: "Такой карточки уже нет",
  same_card: "Это та же карточка",
};

/**
 * The card screen's similar words: each links to its card and can be taken off; another of the
 * user's cards can be found by its Korean or translation and linked, with a note on the difference.
 */
export function SimilarEditor({ card, onChange }: { card: Card; onChange: (card: Card) => void }) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Card[]>([]);
  const [picked, setPicked] = useState<Card>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<number | "add">();
  const [error, setError] = useState<string>();
  const search = useRef<HTMLInputElement>(null);
  const similar = card.similar ?? [];

  useEffect(() => {
    if (adding && !picked) search.current?.focus({ preventScroll: true });
  }, [adding, picked]);

  useEffect(() => {
    const q = query.trim();
    if (!adding || picked || !q) return setFound([]);
    let live = true;
    const timer = setTimeout(() => {
      api.cards({ q, limit: 8 }).then(
        ({ cards }) => live && setFound(cards.filter((c) => c.id !== card.id && !similar.some((s) => s.id === c.id))),
        () => undefined,
      );
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, adding, picked, card.id, similar]);

  function close() {
    setAdding(false);
    setQuery("");
    setPicked(undefined);
    setNote("");
    setFound([]);
  }

  async function run(what: number | "add", action: () => Promise<Card>) {
    setBusy(what);
    setError(undefined);
    try {
      onChange(await action());
      if (what === "add") close();
    } catch (e) {
      const message = (e as Error).message;
      setError(ERRORS[message] ?? message);
    } finally {
      setBusy(undefined);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (picked) void run("add", () => api.linkSimilar(card.id, picked.id, note.trim() || undefined));
  }

  return (
    <div className="similar-editor">
      {similar.length > 0 && (
        <ul className="similar-rows">
          {similar.map((w) => (
            <li key={w.id} className="similar-row">
              <a className="similar-row-main" href={`#/cards/${w.id}`}>
                <span className="similar-row-line">
                  <span lang="ko" className="similar-word">
                    {w.korean}
                  </span>
                  <span className="similar-meaning">{w.meaning}</span>
                </span>
                {w.note && <span className="similar-note">{w.note}</span>}
              </a>
              <button
                type="button"
                className="icon-button similar-remove"
                aria-label={`Убрать связь с ${w.korean}`}
                disabled={busy !== undefined}
                onClick={() => void run(w.id, () => api.unlinkSimilar(card.id, w.id))}
              >
                {busy === w.id ? <Spinner /> : <CloseIcon />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!adding ? (
        <button type="button" className="chip-button similar-add" onClick={() => setAdding(true)}>
          <PairMark />
          {similar.length ? "Добавить ещё" : "Добавить похожее слово"}
        </button>
      ) : (
        <div className="similar-picker">
          {!picked ? (
            <>
              <input
                ref={search}
                className="input"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Найти слово: 쓰레기통 или «ведро»"
                aria-label="Найти карточку"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (found[0]) setPicked(found[0]);
                  }
                }}
              />
              {found.length > 0 && (
                <ul className="similar-found" role="listbox" aria-label="Найденные карточки">
                  {found.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="similar-found-item" role="option" aria-selected={false} onClick={() => setPicked(c)}>
                        <span lang="ko" className="similar-word">
                          {c.korean}
                        </span>
                        <span className="similar-meaning">{c.meaning}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim() && found.length === 0 && <p className="muted small similar-empty">Ничего не нашлось. Сначала добавь это слово.</p>}
            </>
          ) : (
            <div className="similar-pair">
              <p className="similar-pair-words">
                <span lang="ko">{card.korean}</span>
                <span className="similar-ne">≠</span>
                <span lang="ko">{picked.korean}</span>
                <span className="similar-meaning">{picked.meaning}</span>
              </p>
              <textarea
                className="input textarea"
                rows={2}
                maxLength={300}
                placeholder="Чем отличаются, например: у стола / на кухне"
                aria-label="Чем отличаются"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          <div className="similar-picker-actions">
            <button type="button" className="chip-button" onClick={picked ? () => setPicked(undefined) : close}>
              {picked ? "Другое слово" : "Отмена"}
            </button>
            {picked && (
              <button type="button" className="chip-button is-primary" disabled={busy !== undefined} onClick={add}>
                {busy === "add" && <Spinner />}
                Связать
              </button>
            )}
          </div>
        </div>
      )}
      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>
    </div>
  );
}
