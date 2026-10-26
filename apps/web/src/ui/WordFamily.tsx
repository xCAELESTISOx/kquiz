import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Card, Family } from "../lib/types";
import "./family.css";

/** Starts loading a card's word family as soon as the card is on screen, so it is there on reveal. */
export function useFamily(card: Card | undefined): Family[] | undefined {
  const [state, setState] = useState<{ card: Card; families: Family[] }>();
  useEffect(() => {
    if (!card?.roots?.length) return;
    let live = true;
    api.family(card).then(
      (families) => live && setState({ card, families }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [card]);
  return state && state.card === card ? state.families : undefined;
}

const MORE_WORDS = 3;

/**
 * The card's Sino-Korean roots, each with the user's other words that share it: 학 學 «учёба» →
 * 학생, 대학교. A root opens the cards screen filtered to its family. Shows nothing for a native word.
 */
export function WordFamily({ card, families }: { card: Card; families: Family[] | undefined }) {
  if (!card.roots?.length) return null;
  // Until the family arrives, the roots alone; a root repeated in the word is shown once.
  const roots = families ?? card.roots.filter((r, i, all) => all.findIndex((o) => o.hanja === r.hanja) === i);
  return (
    <section className="family" aria-label="Корни слова">
      <ul className="family-list">
        {roots.map((root) => {
          const family = "cards" in root ? (root as Family) : undefined;
          const shown = family?.cards.slice(0, MORE_WORDS) ?? [];
          const more = (family?.total ?? 0) - shown.length;
          return (
            <li key={root.hanja} className="family-root">
              <a
                className="family-key"
                href={`#/cards?root=${encodeURIComponent(root.hanja)}`}
                aria-label={`${root.ko} ${root.hanja}, ${root.meaning}: все слова с этим корнем`}
                // Inside a swipeable card: following the link is not a tap or a swipe on the card.
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span className="family-syllable" lang="ko">
                  {root.ko}
                </span>
                <span className="family-hanja" lang="zh-Hant">
                  {root.hanja}
                </span>
              </a>
              <div className="family-body">
                <p className="family-gloss">{root.meaning}</p>
                {shown.length > 0 && (
                  <p className="family-words">
                    {shown.map((word, i) => (
                      <span key={word.id} className="family-word">
                        {i > 0 && <span className="family-sep">·</span>}
                        <span lang="ko">{word.korean}</span> <span className="family-word-meaning">{word.meaning}</span>
                      </span>
                    ))}
                    {more > 0 && <span className="family-more">и ещё {more}</span>}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
