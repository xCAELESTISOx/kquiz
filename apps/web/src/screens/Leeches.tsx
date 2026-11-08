import { useEffect, useState, type CSSProperties } from "react";
import { api, remembered } from "../lib/api";
import type { Leech } from "../lib/types";
import { EmptyState } from "../ui/EmptyState";

// What to tell Claude in chat; the KQuiz connector's get_leeches tool does the rest.
const ASK_CLAUDE = "Rework my hard cards in KQuiz";

function times(n: number): string {
  return n === 1 ? "once" : `${n} times`;
}

function forgottenText({ forgotten }: Leech): string {
  const parts = [];
  if (forgotten.meaning) parts.push(`meaning ${times(forgotten.meaning)}`);
  if (forgotten.speech) parts.push(`pronunciation ${times(forgotten.speech)}`);
  if (forgotten.listening) parts.push(`listening ${times(forgotten.listening)}`);
  return `Forgotten: ${parts.join(", ")}`;
}

export function LeechesScreen() {
  const [items, setItems] = useState<Leech[] | undefined>(() => remembered.leeches()?.items);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "Hard cards · KQuiz";
    api.leeches().then(
      ({ items }) => setItems(items),
      (e: Error) => setError(e.message),
    );
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(ASK_CLAUDE);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <h1 className="title" lang="ko">
          약점
        </h1>
        <p className="subtitle">Hard cards</p>
      </header>

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      {!items && !error && <div className="skeleton" aria-busy="true" />}

      {items && items.length === 0 && (
        <EmptyState word="좋아요">
          No hard cards. A card lands here once it's forgotten on six different days since its last edit.
        </EmptyState>
      )}

      {items && items.length > 0 && (
        <>
          <ul className="leech-list">
            {items.map((leech, i) => (
              <li key={leech.card.id} style={{ "--i": i } as CSSProperties}>
                <a className="leech-item" href={`#/cards/${leech.card.id}`}>
                  <span className="leech-korean" lang="ko">
                    {leech.card.korean}
                  </span>
                  <span className="leech-meaning">{leech.card.meaning}</span>
                  <span className="leech-count muted small">{forgottenText(leech)}</span>
                </a>
              </li>
            ))}
          </ul>

          <section className="leech-help">
            <p>
              Such a card is usually badly worded or mixed up with another one. Ask Claude to rework it: it will
              rewrite the translation and examples, add a hint or split the card in two. Once edited, the card leaves
              the list. You can also edit or delete it yourself: tap it.
            </p>
            <div className="leech-ask">
              <span>"{ASK_CLAUDE}"</span>
              <button type="button" className="chip-button" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
