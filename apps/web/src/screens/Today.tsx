import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api, auth, lastToday, pendingReviewCount, remembered, rememberToday } from "../lib/api";
import { cardsWord } from "../lib/plural";
import { hideSplash } from "../lib/splash";
import type { QueueItem, Stats, StatsOverview } from "../lib/types";
import { CardsIcon, CloseIcon, HeadphonesIcon, LearnIcon, MicIcon, MoreIcon, PlusIcon, ShuffleIcon } from "../ui/icons";
import { FirstWords } from "../ui/FirstWords";
import { PracticeLinks } from "../ui/PracticeLinks";
import { ScheduleSettings } from "./ScheduleSettings";
import "../ui/today.css";

const PREVIEW = 14;

export function TodayScreen() {
  // Last launch's numbers first, so the screen is never empty while the server answers.
  const [saved] = useState(lastToday);
  const [stats, setStats] = useState<Stats | undefined>(saved?.stats);
  const [preview, setPreview] = useState<QueueItem[]>(saved?.preview ?? []);
  const [error, setError] = useState<string>();
  const [leeches, setLeeches] = useState(() => remembered.leeches()?.items.length ?? 0);
  const [owner, setOwner] = useState(() => remembered.authStatus()?.user?.role === "owner");

  useEffect(() => {
    document.title = "KQuiz";
    // The whole queue, not just the preview: the review screen takes this answer instead of asking again.
    Promise.all([api.stats(), api.queue("meaning")]).then(
      ([s, q]) => {
        const items = q.items.slice(0, PREVIEW);
        setStats(s);
        setPreview(items);
        setError(undefined);
        rememberToday({ stats: s, preview: items });
        if (s.due.speech > 0) api.queue("speech").catch(() => {});
      },
      (e: Error) => setError(e.message),
    );
    api.leeches().then(({ items }) => setLeeches(items.length), () => {});
    auth.status().then((s) => setOwner(s.user?.role === "owner"), () => {});
  }, []);

  useEffect(() => {
    if (stats || error) hideSplash();
  }, [stats, error]);

  const due = stats?.due.meaning ?? 0;
  const speechDue = stats?.due.speech ?? 0;
  const listenDue = stats?.due.listening ?? 0;
  const restDue = speechDue + listenDue;
  const totalDue = due + restDue;
  const queued = stats?.newCards.queued ?? 0;
  // Nothing to learn or review: adding words is the one thing to do.
  const nothing = !!stats && totalDue === 0 && queued === 0;
  // No cards at all, not even queued or paused: nothing to learn, count or practise yet.
  const fresh = stats?.cards === 0;
  const [more, setMore] = useState(false);
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

      {fresh && <FirstWords />}

      {/* The words themselves are the hero: today's queue as a wall of Hangul. */}
      <section hidden={fresh} className="word-wall" aria-label="Слова к повторению" aria-busy={!stats && !error}>
        {stats && due > 0 && (
          <p className="word-wall-words" lang="ko">
            {preview.map(({ card }, i) => (
              <span key={card.id} style={{ opacity: Math.max(1 - i * 0.065, 0.22), "--i": i } as CSSProperties}>
                {card.korean}
              </span>
            ))}
            {due > preview.length && (
              <span className="word-wall-more" style={{ "--i": preview.length } as CSSProperties}>
                +{due - preview.length}
              </span>
            )}
          </p>
        )}
        {stats && due === 0 && (
          <p className="word-wall-empty">
            <DoneMark />
            <span lang="ko" className="word-wall-done">
              다 했어요
            </span>
            <span className="muted">
              {restDue > 0
                ? `Значения повторены. Осталось ${[
                    speechDue > 0 && `проговорить вслух: ${speechDue}`,
                    listenDue > 0 && `узнать на слух: ${listenDue}`,
                  ]
                    .filter(Boolean)
                    .join(", ")}.`
                : queued > 0
                  ? `Повторять нечего. Новых слов ждут ${queued}: «Учить» возьмёт по 5.`
                  : "На сейчас всё повторено. Новые слова можно добавить в любой момент."}
            </span>
          </p>
        )}
        {!stats && !error && <div className="skeleton" />}
      </section>

      {stats && !fresh && <TodayStats stats={stats} />}

      <div aria-live="polite">
        {error && <p className="notice notice-error">Не получилось загрузить данные: {error}. Обнови страницу.</p>}
        {pending > 0 && (
          <p className="notice">
            {pending} {pending === 1 ? "оценка ждёт" : "оценок ждут"} отправки. Уйдут сами, когда появится сеть.
          </p>
        )}
      </div>

      {/* Wait for the numbers, so the wrong button never flashes while they load. */}
      <div className="bottom-actions" hidden={!stats && !error}>
        {fresh ? (
          <a className="button primary" href="#/add">
            Добавить первые слова
          </a>
        ) : nothing ? (
          <a className="button primary" href="#/add">
            Добавить слова
          </a>
        ) : (
          <a className="button primary session-button" href="#/session">
            <span>Учить</span>
            <span className="session-button-sub">
              {[totalDue > 0 && `повторить ${totalDue}`, queued > 0 && `новых слов ${queued}`].filter(Boolean).join(" · ")}
            </span>
          </a>
        )}
        <button type="button" className="button more-button" hidden={fresh} aria-haspopup="dialog" onClick={() => setMore(true)}>
          <MoreIcon />
          Ещё
        </button>
      </div>

      {more && stats && (
        <MoreSheet onClose={() => setMore(false)} due={due} speechDue={speechDue} listenDue={listenDue} leeches={leeches} owner={owner} />
      )}
    </main>
  );
}

const DAYS = 14;

/** A glance at how it goes: the streak, today, and the last two weeks of reviews as bars. */
function TodayStats({ stats }: { stats: Stats }) {
  const [overview, setOverview] = useState<StatsOverview | undefined>(remembered.statsOverview);
  useEffect(() => {
    api.statsOverview().then(setOverview, () => undefined);
  }, [stats]);
  const days = overview?.activity.slice(-DAYS) ?? [];
  const top = Math.max(...days.map((d) => d.reviews), 1);
  const streak = overview?.streak.current ?? 0;
  return (
    <a className="today-stats" href="#/stats" aria-label="Статистика">
      <dl className="today-stats-facts">
        <div>
          <dt>Серия</dt>
          <dd>
            {streak} <span className="muted">{daysWord(streak)}</span>
          </dd>
        </div>
        <div>
          <dt>Сегодня</dt>
          <dd>{stats.reviewedToday}</dd>
        </div>
        <div>
          <dt>Новых слов</dt>
          <dd>{stats.newCards.queued}</dd>
        </div>
      </dl>
      <div className="today-stats-chart" aria-hidden="true">
        {days.map((d, i) => (
          <span
            key={d.day}
            className="today-stats-bar"
            data-today={i === days.length - 1 || undefined}
            style={{ "--h": d.reviews ? Math.max(d.reviews / top, 0.08) : 0, "--i": i } as CSSProperties}
          />
        ))}
      </div>
      <p className="today-stats-caption muted small">Повторения за две недели ›</p>
    </a>
  );
}

function SheetLink({ href, icon, label, count }: { href: string; icon: ReactNode; label: string; count?: number }) {
  return (
    <a href={href}>
      <span className="sheet-icon">{icon}</span>
      <span className="sheet-label">{label}</span>
      {count !== undefined && <span className="button-count">{count}</span>}
    </a>
  );
}

const glyph = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const ChoiceIcon = () => (
  <svg {...glyph}>
    <rect x="3.5" y="4" width="17" height="6" rx="2" />
    <rect x="3.5" y="14" width="17" height="6" rx="2" />
    <path d="m7 7 1.2 1.2L10.5 6" />
  </svg>
);

const LeechIcon = () => (
  <svg {...glyph}>
    <path d="M12 3.5 21 19.5H3Z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
);

const PeopleIcon = () => (
  <svg {...glyph}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
    <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.8c2 .7 3.2 2.5 3.5 5.2" />
  </svg>
);

function daysWord(n: number): string {
  return { карточку: "день", карточки: "дня", карточек: "дней" }[cardsWord(n)]!;
}

/** Everything besides "Учить": each kind of review on its own, practice, and the settings. */
function MoreSheet({
  onClose,
  due,
  speechDue,
  listenDue,
  leeches,
  owner,
}: {
  onClose: () => void;
  due: number;
  speechDue: number;
  listenDue: number;
  leeches: number;
  owner: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  const mixable = [due, speechDue, listenDue].filter((n) => n > 0).length > 1;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Ещё" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <p className="sheet-title">Ещё</p>
          <button type="button" className="icon-button" aria-label="Закрыть" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <nav className="sheet-links" onClick={onClose}>
          {due > 0 && <SheetLink href="#/review" icon={<CardsIcon />} label="Повторить значения" count={due} />}
          {mixable && <SheetLink href="#/mix" icon={<ShuffleIcon />} label="Вперемешку, выбрать способы" />}
          {speechDue > 0 && <SheetLink href="#/speech" icon={<MicIcon />} label="Вслух" count={speechDue} />}
          {speechDue > 0 && <SheetLink href="#/choose" icon={<ChoiceIcon />} label="Выбрать слово из вариантов" />}
          {listenDue > 0 && <SheetLink href="#/listen" icon={<HeadphonesIcon />} label="На слух" count={listenDue} />}
          {leeches > 0 && <SheetLink href="#/leeches" icon={<LeechIcon />} label="Трудные карточки" count={leeches} />}
          <SheetLink href="#/cards/queued" icon={<LearnIcon />} label="Новые слова" />
          <SheetLink href="#/add" icon={<PlusIcon />} label="Добавить слова" />
          {owner && <SheetLink href="#/access" icon={<PeopleIcon />} label="Доступ для друзей" />}
        </nav>
        <PracticeLinks />
        <ScheduleSettings />
      </div>
    </div>
  );
}

/** A check that draws itself once: the one celebratory moment of an empty queue. */
function DoneMark() {
  return (
    <svg className="done-mark" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <circle className="done-mark-ring" cx="28" cy="28" r="25" pathLength={1} />
      <path className="done-mark-check" d="m17 29 7.5 7.5L39 21" pathLength={1} />
    </svg>
  );
}
