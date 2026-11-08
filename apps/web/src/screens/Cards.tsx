import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api, remembered } from "../lib/api";
import { GROUP_SIZE } from "../lib/learn";
import { cardsCount, cardsWord, phrasesWord } from "../lib/plural";
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
    document.title = "Cards · KQuiz";
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
    { id: undefined, label: "All", count: counts?.all },
    { id: "queued", label: "New", count: counts?.queued },
    { id: "phrases", label: "Phrases", count: counts?.phrases },
    { id: "paused", label: "Paused", count: counts?.paused },
  ];

  return (
    <main className="screen">
      <header className="screen-header">
        <h1 className="title" lang="ko">
          카드
        </h1>
        <p className="subtitle">{counts ? cardsCount(counts.all) : "Cards"}</p>
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
          placeholder="Word or translation…"
          aria-label="Search cards"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className="chips" role="toolbar" aria-label="Filters">
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

      {filter === "queued" && <PoolNote />}

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
            "Nothing found. Try another word or clear the filter."
          ) : filter === "queued" ? (
            "No new words: every card is learned and in review."
          ) : filter === "phrases" ? (
            "No phrases yet. Ask Claude to add phrases you want to learn whole."
          ) : filter === "paused" ? (
            "Nothing is paused. You can pause a card in its settings."
          ) : (
            <>
              No cards yet. <a href="#/add">Add your first words</a>.
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
                    {card.kind === "phrase" && filter !== "phrases" && <span className="badge badge-phrase">phrase</span>}
                    {card.queued && filter !== "queued" && <span className="badge">new</span>}
                    {card.suspended && <span className="badge">paused</span>}
                    {!card.speakable && card.kind === "word" && <span className="badge badge-faint">no pronunciation</span>}
                  </span>
                )}
              </a>
              {filter === "queued" && (
                <button type="button" className="row-action" onClick={() => void introduce(card)}>
                  To review
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {nextBefore !== null && (
        <button type="button" className="button" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore && <Spinner />}
          Show more
        </button>
      )}

      <a className="link-button export-link" href={api.exportUrl} download>
        <DownloadIcon />
        Export all as JSON
      </a>
    </main>
  );
}

/** Says which word family the list is narrowed to, and takes the narrowing off. */
function RootBanner({ root, cards, filter }: { root: string; cards: Card[] | undefined; filter?: CardFilter }) {
  const known = cards?.flatMap((c) => c.roots ?? []).find((r) => r.hanja === root);
  return (
    <section className="root-banner" aria-label="Word family">
      <span className="family-key root-banner-key" aria-hidden="true">
        <span className="family-syllable" lang="ko">
          {known?.ko ?? "·"}
        </span>
        <span className="family-hanja" lang="zh-Hant">
          {root}
        </span>
      </span>
      <div className="root-banner-text">
        <p className="family-gloss">{known ? `Root "${known.meaning}"` : "Root"}</p>
        <p className="muted small">All your words with this root</p>
      </div>
      <a className="icon-button" href={filter ? `#/cards/${filter}` : "#/cards"} aria-label="Show all cards">
        <CloseIcon />
      </a>
    </section>
  );
}

/**
 * Just what the list shows: a search, a tag, the queue. "Learn" takes it step by step, GROUP_SIZE
 * words at a time, without touching the schedule (Learn.tsx). "Review" reviews all of it, due or
 * not, in every way at once and in random order; those ratings go into the usual schedule.
 */
/** 1 card, 5 cards; 1 phrase, 5 phrases. */
function groupWord(n: number, phrases: boolean): string {
  return phrases ? phrasesWord(n) : cardsWord(n);
}

function GroupBar({ group, cards, more }: { group: GroupFilter; cards: Card[]; more: boolean }) {
  const active = cards.filter((c) => !c.suspended);
  if (!active.length) return null;
  const queued = active.some((c) => c.queued);
  const count = more ? `${active.length}+` : String(active.length);
  const phrases = group.kind === "phrase";
  return (
    <section className="group-bar" aria-label="Learn the selection">
      <p className="group-bar-title">
        <span className="group-bar-count">{count}</span> {groupWord(more ? 5 : active.length, phrases)} in the group
      </p>
      <div className="group-bar-actions">
        <a className="button primary" href={groupHash("learn", group)}>
          <LearnIcon />
          Learn
        </a>
        <a className="button" href={groupHash("mix", group, { all: true })}>
          <ShuffleIcon />
          Review
        </a>
      </div>
      <p className="muted small">
        {more || active.length > GROUP_SIZE ? `Learn: ${GROUP_SIZE} at a time, no grades. ` : "Learn: step by step, no grades. "}
        Review: every mode mixed{queued ? ", new words enter reviews at once, without learning." : "."}
      </p>
    </section>
  );
}

/** How the new words come in: learned a few at a time in "Learn" on Today, oldest first. */
function PoolNote() {
  return (
    <section className="queue-panel" aria-label="New words">
      <p className="queue-panel-title">New words are learned in order</p>
      <p className="muted small">
        "Learn" on Today takes 5 words at a time from here, top down from the oldest. A learned word moves into review and the next one
        takes its place. "To review" moves a card there at once, without learning.
      </p>
    </section>
  );
}

/** Phrases and long entries take two rows: Korean on top, the translation below. */
function isLong(card: { kind?: string; korean: string }): boolean {
  return card.kind === "phrase" || card.korean.length > 12;
}
