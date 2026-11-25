import type { CSSProperties, ReactNode } from "react";
import type { Skill, StatsOverview } from "../lib/types";
import { MicIcon } from "../ui/icons";
import { BlocksIcon, BulbIcon, ChoiceIcon, EarIcon, HeadphonesIcon, PenIcon } from "../ui/practiceIcons";

/**
 * Which kinds of task go well and which don't (first tries, as Anki counts "correct"), and the words
 * missed most often in any of them (WaniKani's "critical items", Duolingo's mistakes). Both read the
 * answers the sessions log (apps/api taskStats.ts).
 */
export const SKILL: Record<Skill, { label: string; icon: () => ReactNode }> = {
  recall: { label: "Translate", icon: BulbIcon },
  choose: { label: "Pick", icon: ChoiceIcon },
  build: { label: "Build", icon: BlocksIcon },
  write: { label: "Write", icon: PenIcon },
  dictation: { label: "Dictation", icon: EarIcon },
  speak: { label: "Speak", icon: MicIcon },
  listen: { label: "Listen", icon: HeadphonesIcon },
};

/** Fewer answers than this and a percentage is luck: the skill is shown faint, at the end. */
const MIN_ANSWERS = 10;
/** Each side of the trend needs this many answers, and it takes this many points to call it a change. */
const MIN_TREND_ANSWERS = 8;
const TREND_POINTS = 5;

const rate = (answers: number, missed: number) => (answers ? (answers - missed) / answers : 0);

/** Green at 90 % and up, then the accent, amber, and red under 60 %. */
function tone(pct: number) {
  return pct >= 90 ? "good" : pct >= 75 ? "fair" : pct >= 60 ? "weak" : "poor";
}

export function Skills({ stats }: { stats: StatsOverview }) {
  const skills = (stats.skills ?? []).filter((s) => s.answers > 0);
  if (!skills.length) return <p className="stats-note">Shows up after a few sessions.</p>;
  const sorted = [...skills].sort(
    (a, b) => Number(b.answers >= MIN_ANSWERS) - Number(a.answers >= MIN_ANSWERS) || rate(b.answers, b.missed) - rate(a.answers, a.missed) || b.answers - a.answers,
  );
  return (
    <ul className="skills">
      {sorted.map((s, i) => {
        const pct = Math.round(rate(s.answers, s.missed) * 100);
        const enough = s.answers >= MIN_ANSWERS;
        const { label, icon: Icon } = SKILL[s.skill];
        const trend = skillTrend(s);
        return (
          <li key={s.skill} data-faint={!enough || undefined} title={`${s.answers - s.missed} of ${s.answers}`} style={{ "--i": i } as CSSProperties}>
            <span className="skill-icon">
              <Icon />
            </span>
            <div className="skill-body">
              <div className="skill-head">
                <span>{label}</span>
                {trend && (
                  <span className="skill-trend" data-trend={trend} aria-label={trend === "better" ? "better this week" : "worse this week"}>
                    {trend === "better" ? "↑" : "↓"}
                  </span>
                )}
                <strong>{pct}%</strong>
              </div>
              <div className="meter meter-skill" data-tone={tone(pct)}>
                <span style={{ width: `${pct}%` }} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** This week against the three before it. */
function skillTrend(s: NonNullable<StatsOverview["skills"]>[number]): "better" | "worse" | undefined {
  const older = { answers: s.answers - s.recent.answers, missed: s.missed - s.recent.missed };
  if (s.recent.answers < MIN_TREND_ANSWERS || older.answers < MIN_TREND_ANSWERS) return undefined;
  const change = (rate(s.recent.answers, s.recent.missed) - rate(older.answers, older.missed)) * 100;
  return change >= TREND_POINTS ? "better" : change <= -TREND_POINTS ? "worse" : undefined;
}

export function Trouble({ stats }: { stats: StatsOverview }) {
  const words = stats.trouble ?? [];
  if (!words.length) return <p className="stats-note">No mistakes yet.</p>;
  const most = Math.max(...words.map((w) => w.missed));
  return (
    <ol className="trouble">
      {words.map((w, i) => (
        <li key={w.card.id} style={{ "--i": i } as CSSProperties}>
          <a href={`#/cards/${w.card.id}`}>
            <span className="trouble-rank">{i + 1}</span>
            <span className="trouble-word">
              <span lang="ko">{w.card.korean}</span>
              <span className="trouble-meaning">{w.card.meaning}</span>
            </span>
            <span className="trouble-skills" aria-label={`missed in ${w.skills.map((s) => SKILL[s].label).join(", ")}`}>
              {w.skills.map((s) => {
                const Icon = SKILL[s].icon;
                return (
                  <span key={s} title={SKILL[s].label}>
                    <Icon />
                  </span>
                );
              })}
            </span>
            <span
              className="trouble-count"
              style={{ "--heat": 0.35 + 0.65 * (w.missed / most) } as CSSProperties}
              aria-label={`${w.missed} mistakes in ${w.answers} answers`}
            >
              {w.missed}
              <small>/{w.answers}</small>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}
