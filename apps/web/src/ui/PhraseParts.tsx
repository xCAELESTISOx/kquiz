import type { Card } from "../lib/types";
import { REGISTER_LABELS } from "../lib/phrase";
import "./phrase.css";

/**
 * A phrase glossed piece by piece, interlinear: each piece over its meaning, with its dictionary form
 * when that differs. A piece the user has a card for opens that card.
 */
export function PhraseParts({ card, links = true }: { card: Card; links?: boolean }) {
  if (!card.parts?.length) return null;
  return (
    <ol className="parts" aria-label="Из чего состоит фраза">
      {card.parts.map((part, i) => {
        const body = (
          <>
            <span className="part-ko" lang="ko">
              {part.ko}
            </span>
            <span className="part-meaning">{part.meaning}</span>
            {part.base && part.base !== part.ko && (
              <span className="part-base" lang="ko">
                {part.base}
              </span>
            )}
          </>
        );
        return (
          <li key={i} className="part">
            {links && part.cardId ? (
              <a
                className="part-body is-linked"
                href={`#/cards/${part.cardId}`}
                aria-label={`${part.ko}: ${part.meaning}, открыть карточку`}
                // Inside a swipeable card: following the link is not a tap or a swipe on the card.
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {body}
              </a>
            ) : (
              <span className="part-body">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function RegisterBadge({ card }: { card: Card }) {
  if (!card.register) return null;
  return (
    <span className={`register register-${card.register}`} title="Уровень вежливости">
      {REGISTER_LABELS[card.register]}
    </span>
  );
}
