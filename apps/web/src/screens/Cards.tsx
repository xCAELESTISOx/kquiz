import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api, remembered } from "../lib/api";
import { GROUP_SIZE } from "../lib/learn";
import { lessonDate } from "../lib/lessons";
import { cardsCount, cardsWord, phrasesWord, wordsWord } from "../lib/plural";
import { groupHash } from "../lib/router";
import type { Card, CardFilter, CardSummary, GroupFilter, Stats } from "../lib/types";
import { CloseIcon, DownloadIcon, LearnIcon, SearchIcon, ShuffleIcon } from "../ui/icons";
import { EmptyState } from "../ui/EmptyState";
import { Spinner } from "../ui/Spinner";
import "../ui/family.css";

const PAGE = 50;

/** Where "back" from a card goes: the list as it was left, filter included. */
export let lastCardsHash = "#/cards";

const listQuery = (query: string, tag: string | undefined, filter: CardFilter | undefined, root?: string) => ({
  q: query.trim(),
  tag,
  root,
  status: filter === "phrases" ? undefined : filter,
  kind: filter === "phrases" ? ("phrase" as const) : undefined,
  limit: PAGE,
});

/** `root` (a hanja) narrows the list to one word family, as opened from a card's roots. */
export function CardsScreen({ filter, root }: { filter?: CardFilter; root?: string }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string>();
  // The list as last seen comes up at once; the fresh one replaces it when it arrives.
  const [saved] = useState(() => remembered.cards(listQuery("", undefined, filter, root)));
  const [cards, setCards] = useState<Card[] | undefined>(saved?.cards);
  const [nextBefore, setNextBefore] = useState<number | null>(saved?.nextBefore ?? null);
  const [summary, setSummary] = useState<CardSummary | undefined>(remembered.cardSummary);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  // Answers can arrive out of order while typing; only the latest one is shown.
  const requestId = useRef(0);

  useEffect(() => {
    document.title = "Карточки · KQuiz";
    lastCardsHash = (filter ? `#/cards/${filter}` : "#/cards") + (root ? `?root=${encodeURIComponent(root)}` : "");
  }, [filter, root]);

  const refreshSummary = () => api.cardSummary().then(setSummary, () => undefined);
  useEffect(() => void refreshSummary(), []);

  useEffect(() => {
    const id = ++requestId.current;
    const seen = remembered.cards(listQuery(query, tag, filter, root));
    if (seen) {
      setCards(seen.cards);
      setNextBefore(seen.nextBefore);
    }
    const timer = setTimeout(
      () => {
        api.cards(listQuery(query, tag, filter, root)).then(
          (res) => {
            if (id !== requestId.current) return;
            setCards(res.cards);
            setNextBefore(res.nextBefore);
            setError(undefined);
          },
          (e: Error) => id === requestId.current && setError(e.message),
        );
      },
      query ? 220 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, tag, filter, root]);

  async function loadMore() {
    if (nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.cards({ ...listQuery(query, tag, filter, root), before: nextBefore });
      setCards((list) => [...(list ?? []), ...res.cards]);
      setNextBefore(res.nextBefore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function introduce(card: Card) {
    try {
      await api.introduceCard(card.id);
      setCards((list) => list?.filter((c) => c.id !== card.id));
      void refreshSummary();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const counts = summary?.counts;
  const filters: { id: CardFilter | undefined; label: string; count?: number }[] = [
    { id: undefined, label: "Все", count: counts?.all },
    { id: "queued", label: "Новые", count: counts?.queued },
    { id: "phrases", label: "Фразы", count: counts?.phrases },
    { id: "paused", label: "Пауза", count: counts?.paused },
  ];

  return (
    <main className="screen">
      <header className="screen-header">
        <h1 className="title" lang="ko">
          카드
        </h1>
        <p className="subtitle">{counts ? cardsCount(counts.all) : "Карточки"}</p>
      </header>

      <label className="search">
        <SearchIcon />
        <input
          className="input search-input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Слово или перевод…"
          aria-label="Поиск по карточкам"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className="chips" role="toolbar" aria-label="Фильтры">
        {filters.map((f) => (
          <a
            key={f.label}
            className="chip"
            href={(f.id ? `#/cards/${f.id}` : "#/cards") + (root ? `?root=${encodeURIComponent(root)}` : "")}
            aria-current={filter === f.id ? "page" : undefined}
            // A filter that would show nothing stays out of the way, unless it is the open one.
            hidden={f.id !== undefined && f.count === 0 && filter !== f.id}
          >
            {f.label}
            {f.count !== undefined && <span className="chip-count">{f.count}</span>}
          </a>
        ))}
        {summary?.tags.map(({ tag: t }) => (
          <button key={t} type="button" className="chip chip-tag" aria-pressed={tag === t} onClick={() => setTag(tag === t ? undefined : t)}>
            #{t}
          </button>
        ))}
      </div>

      {root && <RootBanner root={root} cards={cards} filter={filter} />}

      {filter === "queued" && <LessonsPanel />}

      {cards && (query.trim() || tag || root || filter === "queued" || filter === "phrases") && filter !== "paused" && (
        <GroupBar
          group={{
            q: query.trim() || undefined,
            tag,
            root,
            status: filter === "queued" ? "queued" : undefined,
            kind: filter === "phrases" ? "phrase" : undefined,
          }}
          cards={cards}
          more={nextBefore !== null}
        />
      )}

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      {!cards && !error && <div className="skeleton card-list-skeleton" aria-busy="true" />}

      {cards && cards.length === 0 && (
        <EmptyState word={query || tag || root || filter === "paused" ? "없어요" : "비었어요"}>
          {query || tag || root ? (
            "Ничего не нашлось. Попробуй другое слово или сними фильтр."
          ) : filter === "queued" ? (
            "Новых слов нет: все карточки уже выучены и в повторении."
          ) : filter === "phrases" ? (
            "Фраз пока нет. Попроси Claude добавить фразы, которые хочешь выучить целиком."
          ) : filter === "paused" ? (
            "На паузе ничего нет. Поставить карточку на паузу можно в её настройках."
          ) : (
            <>
              Карточек пока нет. <a href="#/add">Добавь первые слова</a>.
            </>
          )}
        </EmptyState>
      )}

      {cards && cards.length > 0 && (
        <ul className="card-list">
          {cards.map((card, i) => (
            <li key={card.id} className="card-row" style={{ "--i": Math.min(i, 12) } as CSSProperties}>
              <a className={`card-row-link${isLong(card) ? " card-row-link-long" : ""}`} href={`#/cards/${card.id}`}>
                <span className="card-row-korean" lang="ko">
                  {card.korean}
                </span>
                <span className="card-row-meaning">{card.meaning}</span>
                {(card.suspended || (card.queued && filter !== "queued") || card.kind === "phrase" || !card.speakable) && (
                  <span className="card-row-badges">
                    {card.kind === "phrase" && filter !== "phrases" && <span className="badge badge-phrase">фраза</span>}
                    {card.queued && filter !== "queued" && <span className="badge">новое</span>}
                    {card.suspended && <span className="badge">пауза</span>}
                    {!card.speakable && card.kind === "word" && <span className="badge badge-faint">без произношения</span>}
                  </span>
                )}
              </a>
              {filter === "queued" && (
                <button type="button" className="row-action" onClick={() => void introduce(card)}>
                  В повторение
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {nextBefore !== null && (
        <button type="button" className="button" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore && <Spinner />}
          Показать ещё
        </button>
      )}

      <a className="link-button export-link" href={api.exportUrl} download>
        <DownloadIcon />
        Выгрузить всё в JSON
      </a>
    </main>
  );
}

/** Says which word family the list is narrowed to, and takes the narrowing off. */
function RootBanner({ root, cards, filter }: { root: string; cards: Card[] | undefined; filter?: CardFilter }) {
  const known = cards?.flatMap((c) => c.roots ?? []).find((r) => r.hanja === root);
  return (
    <section className="root-banner" aria-label="Семья слова">
      <span className="family-key root-banner-key" aria-hidden="true">
        <span className="family-syllable" lang="ko">
          {known?.ko ?? "·"}
        </span>
        <span className="family-hanja" lang="zh-Hant">
          {root}
        </span>
      </span>
      <div className="root-banner-text">
        <p className="family-gloss">{known ? `Корень «${known.meaning}»` : "Корень"}</p>
        <p className="muted small">Все твои слова с этим корнем</p>
      </div>
      <a className="icon-button" href={filter ? `#/cards/${filter}` : "#/cards"} aria-label="Показать все карточки">
        <CloseIcon />
      </a>
    </section>
  );
}

/**
 * Just what the list shows: a search, a tag, the queue. "Учить" takes it step by step, GROUP_SIZE
 * words at a time, without touching the schedule (Learn.tsx). "Повторить" reviews all of it, due or
 * not, in every way at once and in random order; those ratings go into the usual schedule.
 */
/** Nominative: 1 карточка, 2 карточки, 5 карточек; 1 фраза, 2 фразы, 5 фраз. */
function groupWord(n: number, phrases: boolean): string {
  const word = cardsWord(n);
  if (!phrases) return word === "карточку" ? "карточка" : word;
  return word === "карточку" ? "фраза" : phrasesWord(n);
}

function GroupBar({ group, cards, more }: { group: GroupFilter; cards: Card[]; more: boolean }) {
  const active = cards.filter((c) => !c.suspended);
  if (!active.length) return null;
  const queued = active.some((c) => c.queued);
  const count = more ? `${active.length}+` : String(active.length);
  const phrases = group.kind === "phrase";
  return (
    <section className="group-bar" aria-label="Учить выбранные">
      <p className="group-bar-title">
        В группе <span className="group-bar-count">{count}</span> {groupWord(more ? 5 : active.length, phrases)}
      </p>
      <div className="group-bar-actions">
        <a className="button primary" href={groupHash("learn", group)}>
          <LearnIcon />
          Учить
        </a>
        <a className="button" href={groupHash("mix", group, { all: true })}>
          <ShuffleIcon />
          Повторить
        </a>
      </div>
      <p className="muted small">
        {more || active.length > GROUP_SIZE ? `Учить — по ${GROUP_SIZE} за раз, без оценок. ` : "Учить — по шагам, без оценок. "}
        Повторить — все режимы вперемешку{queued ? ", новые слова войдут в повторение сразу, без обучения." : "."}
      </p>
    </section>
  );
}

/** The lessons of new words, oldest first: each is learned whole before its words are reviewed. */
function LessonsPanel() {
  const [stats, setStats] = useState<Stats | undefined>(remembered.stats);
  useEffect(() => {
    api.stats().then(setStats, () => undefined);
  }, []);
  const lessons = stats?.newCards.lessons ?? [];
  return (
    <section className="queue-panel" aria-label="Уроки новых слов">
      {lessons.length > 0 && (
        <ol className="lesson-list">
          {lessons.map((lesson, i) => (
            <li key={lesson.day} className="lesson-row">
              <span>
                <span className="queue-panel-title">{lessonDate(lesson.day)}</span>
                <span className="muted small"> · {lesson.count} {wordsWord(lesson.count)}</span>
              </span>
              <a className={`chip-button${i === 0 ? " chip-button-accent" : ""}`} href={groupHash("learn", { status: "queued", lesson: lesson.day })}>
                Учить
              </a>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">
        Новые слова сначала учатся, потом входят в повторение. Слова, добавленные в один день, — один урок; уроки идут по порядку.
        «В повторение» берёт карточку сразу, без обучения.
      </p>
    </section>
  );
}

/** Фразы и длинные записи идут в два ряда: корейский сверху, перевод под ним. */
function isLong(card: { kind?: string; korean: string }): boolean {
  return card.kind === "phrase" || card.korean.length > 12;
}
