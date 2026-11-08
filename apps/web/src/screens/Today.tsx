import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api, auth, lastToday, pendingReviewCount, remembered, rememberToday } from "../lib/api";
import { wordsWord } from "../lib/plural";
import { bootDeadline, hideSplash, splashShown } from "../lib/splash";
import type { QueueItem, Stats, StatsOverview } from "../lib/types";
import { CardsIcon, CloseIcon, HeadphonesIcon, LearnIcon, MicIcon, MoreIcon, PlusIcon, ShuffleIcon } from "../ui/icons";
import { FirstWords } from "../ui/FirstWords";
import { PracticeLinks } from "../ui/PracticeLinks";
import { ScheduleSettings } from "./ScheduleSettings";
import "../ui/today.css";

/** Words on the wall at most: the ones due first, then the next new ones. */
const PREVIEW = 14;
/** Syllables the wall holds, so a few long phrases don't push everything else off the screen. */
const WALL_SYLLABLES = 28;
/** Longer than this, a phrase stays off the wall (it is still counted in "+N"). */
const LONG = 9;

/** Each due word once (the queue lists a word due in two modes twice), short ones only. */
function dueWords(items: QueueItem[]): QueueItem[] {
  const seen = new Set<number>();
  return items
    .filter(({ card }) => !seen.has(card.id) && (seen.add(card.id), true) && card.korean.length <= LONG)
    .slice(0, PREVIEW);
}

/** The first of `words` that fit in `budget` syllables. */
function fitting<T>(words: T[], korean: (w: T) => string, budget: number): T[] {
  const out: T[] = [];
  for (const w of words) {
    budget -= korean(w).length;
    if (budget < 0) break;
    out.push(w);
  }
  return out;
}

export function TodayScreen() {
  // Last launch's numbers first, so the screen is never empty while the server answers.
  const [saved] = useState(lastToday);
  const [loaded, setLoaded] = useState<Stats | undefined>(saved?.stats);
  const [overview, setOverview] = useState<StatsOverview | undefined>(remembered.statsOverview);
  // On launch the screen stays behind the splash until everything on it is in, so nothing shifts
  // after it shows; last launch's numbers are only the fallback for a server too slow to answer.
  const [ready, setReady] = useState(() => !splashShown());
  const [preview, setPreview] = useState<QueueItem[]>(saved?.preview ?? []);
  const [error, setError] = useState<string>();
  const [leeches, setLeeches] = useState(() => remembered.leeches()?.items.length ?? 0);
  const [owner, setOwner] = useState(() => remembered.authStatus()?.user?.role === "owner");

  useEffect(() => {
    document.title = "KQuiz";
    // The whole queue, not just the preview: the session takes this answer instead of asking again.
    Promise.all([api.stats(), api.queue("mixed", 200), api.statsOverview().catch(() => undefined)]).then(
      ([s, q, o]) => {
        const items = dueWords(q.items);
        setLoaded(s);
        if (o) setOverview(o);
        setReady(true);
        setPreview(items);
        setError(undefined);
        rememberToday({ stats: s, preview: items });
        if (s.due.speech > 0) api.queue("speech").catch(() => {});
      },
      (e: Error) => {
        setError(e.message);
        setReady(true);
      },
    );
    api.leeches().then(({ items }) => setLeeches(items.length), () => {});
    auth.status().then((s) => setOwner(s.user?.role === "owner"), () => {});
  }, []);

  useEffect(() => {
    let live = true;
    void bootDeadline().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (ready) hideSplash();
  }, [ready]);

  const stats = ready ? loaded : undefined;

  const due = stats?.due.meaning ?? 0;
  const dueCount = stats?.dueWords ?? 0;
  const wall = fitting(preview, (i) => i.card.korean, WALL_SYLLABLES);
  const moreDue = Math.max(dueCount - wall.length, 0);
  // Room left on the wall goes to the new words, so it is never one lonely word.
  const left = WALL_SYLLABLES - wall.reduce((n, i) => n + i.card.korean.length, 0);
  const upcoming = fitting(
    (stats?.newCards.next ?? []).filter((k) => k.length <= LONG),
    (k) => k,
    left,
  ).slice(0, Math.max(PREVIEW - wall.length, 0));
  // What "Учить" goes on with: words already started first, new ones only when few are unfinished.
  const started = stats?.newCards.started ?? 0;
  const portion = stats?.newCards.fresh ?? 0;
  const learning = stats?.newCards.learning ?? 0;
  const pool = stats?.newCards.pool ?? 0;
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

      {/* The words themselves are the hero: the ones to go over, then the new ones coming up. */}
      <section hidden={fresh} className="word-wall" aria-label="Слова на сегодня" aria-busy={!stats && !error}>
        {stats && (wall.length + upcoming.length > 0 ? <WordWall due={wall} more={moreDue} fresh={upcoming} /> : <AllDone />)}
        {stats && wall.length + upcoming.length > 0 && (
          <ul className="word-wall-legend">
            {dueCount > 0 && <li data-kind="due">повторить {dueCount}</li>}
            {learning > 0 && <li data-kind="new">учатся {learning}</li>}
            {pool > 0 && <li data-kind="pool">в очереди {pool}</li>}
          </ul>
        )}
        {!stats && !error && <div className="skeleton" />}
      </section>

      {stats && !fresh && <TodayStats stats={stats} overview={overview} />}

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
              {[
                dueCount > 0 && `повторить ${dueCount} ${wordsWord(dueCount)}`,
                started > 0 && `доучить ${started}`,
                portion > 0 && `выучить ${portion} ${portion === 1 ? "новое" : "новых"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
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
function TodayStats({ stats, overview }: { stats: Stats; overview?: StatsOverview }) {
  const days = overview?.activity.slice(-DAYS) ?? [];
  const top = Math.max(...days.map((d) => d.reviews), 1);
  const streak = overview?.streak.current ?? 0;
  return (
    <a className="today-stats" href="#/stats" aria-label="Статистика">
      <dl className="today-stats-facts">
        <div>
          <dt>Дней подряд</dt>
          <dd>
            {streak}
          </dd>
        </div>
        <div>
          <dt>Повторено сегодня</dt>
          <dd>{stats.reviewedToday}</dd>
        </div>
        <div>
          <dt>Выучено слов</dt>
          <dd>
            {stats.learned}
            {stats.learnedToday > 0 && <span className="today-stats-plus"> +{stats.learnedToday}</span>}
          </dd>
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
      <p className="today-stats-caption muted small">
        Повторения по дням, последние две недели <span aria-hidden="true">›</span>
      </p>
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

/** Today's words as a wall of Hangul: the ones due bright and fading, the new ones after them in the accent. */
function WordWall({ due, more, fresh }: { due: QueueItem[]; more: number; fresh: string[] }) {
  return (
    <p className="word-wall-words" lang="ko">
      {due.map(({ card }, i) => (
        <span key={card.id} style={{ opacity: Math.max(1 - i * 0.065, 0.3), "--i": i } as CSSProperties}>
          {card.korean}
        </span>
      ))}
      {more > 0 && (
        <span className="word-wall-more" style={{ "--i": due.length } as CSSProperties}>
          +{more}
        </span>
      )}
      {fresh.map((korean, i) => (
        <span
          key={`new-${korean}`}
          className="word-wall-new"
          style={{ opacity: Math.max(0.85 - i * 0.07, 0.25), "--i": due.length + i + 1 } as CSSProperties}
        >
          {korean}
        </span>
      ))}
    </p>
  );
}

/** Nothing due and no new words: the one celebratory moment. */
function AllDone() {
  return (
    <p className="word-wall-empty">
      <DoneMark />
      <span lang="ko" className="word-wall-done">
        다 했어요
      </span>
      <span className="muted">Всё выученное повторено, новых слов в очереди нет. Добавьте слова с занятия, когда будут.</span>
    </p>
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
