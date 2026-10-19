import { useEffect, useState } from "react";
import { api, pendingReviewCount } from "../lib/api";
import { cardsWord } from "../lib/plural";
import type { QueueItem, Stats } from "../lib/types";
import { MicIcon } from "../ui/icons";

const PREVIEW = 14;

export function TodayScreen() {
  const [stats, setStats] = useState<Stats>();
  const [preview, setPreview] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    document.title = "KQuiz";
    Promise.all([api.stats(), api.queue("meaning", PREVIEW)]).then(
      ([s, q]) => {
        setStats(s);
        setPreview(q.items);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  const due = stats?.due.meaning ?? 0;
  const speechDue = stats?.due.speech ?? 0;
  const pending = pendingReviewCount();
  const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <main className="screen">
      <header className="screen-header">
        <h1 className="title" lang="ko">
          오늘
        </h1>
        <p className="subtitle">{today}</p>
      </header>

      {/* The words themselves are the hero: today's queue as a wall of Hangul. */}
      <section className="word-wall" aria-label="Слова к повторению" aria-busy={!stats && !error}>
        {stats && due > 0 && (
          <p className="word-wall-words" lang="ko">
            {preview.map(({ card }, i) => (
              <span key={card.id} style={{ opacity: Math.max(1 - i * 0.065, 0.22) }}>
                {card.korean}
              </span>
            ))}
            {due > preview.length && <span className="word-wall-more">+{due - preview.length}</span>}
          </p>
        )}
        {stats && due === 0 && (
          <p className="word-wall-empty">
            <span lang="ko" className="word-wall-done">
              다 했어요
            </span>
            <span className="muted">
              {speechDue > 0
                ? `Значения повторены. Осталось проговорить вслух: ${speechDue}.`
                : "На сейчас всё повторено. Новые слова можно добавить в любой момент."}
            </span>
          </p>
        )}
        {!stats && !error && <div className="skeleton" />}
      </section>

      {stats && (
        <dl className="facts">
          <div>
            <dt>К повторению</dt>
            <dd>{due}</dd>
          </div>
          <div>
            <dt>Произношение</dt>
            <dd>{stats.due.speech}</dd>
          </div>
          <div>
            <dt>Повторено</dt>
            <dd>{stats.reviewedToday}</dd>
          </div>
        </dl>
      )}

      <div aria-live="polite">
        {error && <p className="notice notice-error">Не получилось загрузить данные: {error}. Обнови страницу.</p>}
        {pending > 0 && (
          <p className="notice">
            {pending} {pending === 1 ? "оценка ждёт" : "оценок ждут"} отправки. Уйдут сами, когда появится сеть.
          </p>
        )}
      </div>

      <div className="bottom-actions">
        {due > 0 && (
          <a className="button primary" href="#/review">
            Повторить {due} {cardsWord(due)}
          </a>
        )}
        {speechDue > 0 && (
          <a className={`button${due > 0 ? "" : " primary"}`} href="#/speech">
            <MicIcon />
            Произношение · {speechDue}
          </a>
        )}
        {due === 0 && speechDue === 0 && (
          <a className="button" href="#/add">
            Добавить слова
          </a>
        )}
      </div>
    </main>
  );
}
