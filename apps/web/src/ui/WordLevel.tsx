import type { CSSProperties } from "react";
import type { Direction, Level, WordScore } from "../lib/types";
import "./word-level.css";

/**
 * How well a word is known, from its score (apps/api wordScore.ts): a dot by the word in lists, a
 * panel on its card, a bar of all words in the stats. A miss costs more than a task earns, and a
 * word missed today can't turn green today.
 */
export const LEVEL: Record<Level, { label: string; hint: string }> = {
  new: { label: "New", hint: "Not asked yet" },
  learning: { label: "Learning", hint: "Still being learned" },
  familiar: { label: "Familiar", hint: "Remembered, not yet every way" },
  known: { label: "Known", hint: "Right every way, after a clean session" },
  solid: { label: "Solid", hint: "Known well" },
};
/** From the top down, as the stats list them. */
export const LEVELS_DOWN: Level[] = ["solid", "known", "familiar", "learning", "new"];
export const MAX_SCORE = 20;

const WAY: Record<Direction, string> = { meaning: "Meaning", say: "Korean", ear: "By ear" };

export function LevelDot({ score }: { score: WordScore | undefined }) {
  if (!score || score.level === "new") return null;
  return (
    <span
      className="level-dot"
      data-level={score.level}
      data-fading={score.fading || undefined}
      title={`${LEVEL[score.level].label}${score.fading ? ", time to check" : ""}`}
      aria-label={LEVEL[score.level].label}
    />
  );
}

/** On a card: its level, points, and how the last answer each way went. */
export function LevelPanel({ score }: { score: WordScore | undefined }) {
  if (!score) return null;
  const { label, hint } = LEVEL[score.level];
  return (
    <div className="level-panel" data-level={score.level} data-fading={score.fading || undefined}>
      <div className="level-panel-head">
        <span className="level-dot" data-level={score.level} aria-hidden="true" />
        <strong>{label}</strong>
        <span className="level-points">
          {formatPoints(score.score)}
          <small>/{MAX_SCORE}</small>
        </span>
      </div>
      <div className="level-meter" aria-hidden="true">
        <span style={{ width: `${(score.score / MAX_SCORE) * 100}%` }} />
      </div>
      <p className="level-hint">
        {score.fading ? "Time to check it again" : hint}
        {(Object.keys(WAY) as Direction[])
          .filter((d) => score.last[d])
          .map((d) => (
            <span key={d} className="level-way" data-last={score.last[d]}>
              {score.last[d] === "right" ? "✓" : "✗"} {WAY[d]}
            </span>
          ))}
      </p>
    </div>
  );
}

/** All words by level, as one bar and its legend. */
export function LevelBar({ levels }: { levels: Record<Level, number> | undefined }) {
  const total = levels ? LEVELS_DOWN.reduce((sum, l) => sum + levels[l], 0) : 0;
  if (!levels || !total) return <p className="stats-note">Shows up after a few sessions.</p>;
  const shown = LEVELS_DOWN.filter((l) => levels[l] > 0);
  return (
    <div className="level-bar-wrap">
      <div className="level-bar" role="img" aria-label={shown.map((l) => `${LEVEL[l].label} ${levels[l]}`).join(", ")}>
        {shown.map((l) => (
          <span key={l} data-level={l} style={{ flexGrow: levels[l] } as CSSProperties} />
        ))}
      </div>
      <ul className="level-legend">
        {shown.map((l) => (
          <li key={l} title={LEVEL[l].hint}>
            <span className="level-dot" data-level={l} aria-hidden="true" />
            {LEVEL[l].label}
            <strong>{levels[l]}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

const formatPoints = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
