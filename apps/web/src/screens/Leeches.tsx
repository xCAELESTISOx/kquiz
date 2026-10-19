import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../lib/api";
import type { Leech } from "../lib/types";
import { EmptyState } from "../ui/EmptyState";

// What to tell Claude in chat; the KQuiz connector's get_leeches tool does the rest.
const ASK_CLAUDE = "Переделай мои трудные карточки в KQuiz";

function times(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "раза" : "раз";
}

function forgottenText({ forgotten }: Leech): string {
  const parts = [];
  if (forgotten.meaning) parts.push(`перевод — ${forgotten.meaning} ${times(forgotten.meaning)}`);
  if (forgotten.speech) parts.push(`произношение — ${forgotten.speech} ${times(forgotten.speech)}`);
  if (forgotten.listening) parts.push(`на слух — ${forgotten.listening} ${times(forgotten.listening)}`);
  return `Забыта: ${parts.join(", ")}`;
}

export function LeechesScreen() {
  const [items, setItems] = useState<Leech[]>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "Трудные карточки · KQuiz";
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
        <p className="subtitle">Трудные карточки</p>
      </header>

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      {!items && !error && <div className="skeleton" aria-busy="true" />}

      {items && items.length === 0 && (
        <EmptyState word="좋아요">
          Трудных карточек нет. Сюда попадает карточка, забытая в шесть разных дней после последней правки.
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
              Обычно такая карточка плохо сформулирована или путается с соседней. Попроси Claude её переделать: он
              перепишет перевод и примеры, добавит подсказку или разделит карточку на две. После правки карточка уходит
              из списка. Поправить или удалить её можешь и сам: нажми на неё.
            </p>
            <div className="leech-ask">
              <span>«{ASK_CLAUDE}»</span>
              <button type="button" className="chip-button" onClick={() => void copy()}>
                {copied ? "Скопировано" : "Скопировать"}
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
