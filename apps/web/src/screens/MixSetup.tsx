import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api, remembered } from "../lib/api";
import { canRecord } from "../lib/recorder";
import type { MixKind, Stats } from "../lib/types";
import { CardsIcon, CheckIcon, HeadphonesIcon, MicIcon } from "../ui/icons";
import { ChoiceIcon, EarIcon, PenIcon } from "../ui/practiceIcons";
import "../ui/practice.css";

const KINDS: { kind: MixKind; title: string; sub: string; icon: ReactNode }[] = [
  {
    kind: "meaning",
    title: "Translation",
    sub: "Word → recall the translation, phrase → build it from blocks",
    icon: <CardsIcon />,
  },
  {
    kind: "aloud",
    title: "Aloud",
    sub: "Translation → say it in Korean",
    icon: <MicIcon />,
  },
  {
    kind: "choice",
    title: "Choose from options",
    sub: "Translation → find the word among similar ones",
    icon: <ChoiceIcon />,
  },
  {
    kind: "write",
    title: "Type from translation",
    sub: "Translation → type it in Hangul",
    icon: <PenIcon />,
  },
  {
    kind: "listening",
    title: "Listening",
    sub: "Listen → recall the translation",
    icon: <HeadphonesIcon />,
  },
  {
    kind: "dictation",
    title: "Type what you hear",
    sub: "Listen → type the word or build the phrase",
    icon: <EarIcon />,
  },
];

const SPEECH_KINDS: ReadonlySet<MixKind> = new Set(["aloud", "choice", "write"]);

// How the ways read when only phrases are mixed.
const PHRASE_TEXT: Partial<Record<MixKind, { title: string; sub: string }>> = {
  meaning: { title: "Build from translation", sub: "Translation → build the phrase from blocks" },
  dictation: { title: "Build what you hear", sub: "Listen → build the phrase from blocks" },
};

/**
 * What goes into a mixed session, picked before it starts; everything but typing by default. Saying aloud,
 * picking and typing by translation all go through the speech schedule, so they share one count;
 * typing by ear shares the listening one.
 */
export function MixSetup({
  counted,
  phrases,
  onStart,
}: {
  counted: boolean;
  /** Only phrases: nothing goes through the speech schedule, so its ways are left out. */
  phrases?: boolean;
  onStart: (kinds: ReadonlySet<MixKind>) => void;
}) {
  const recordable = canRecord();
  const shown = phrases ? KINDS.filter((k) => !SPEECH_KINDS.has(k.kind)).map((k) => ({ ...k, ...PHRASE_TEXT[k.kind] })) : KINDS;
  const [kinds, setKinds] = useState<ReadonlySet<MixKind>>(
    // Typing takes the keyboard out, so it joins only when picked. Building a phrase by ear doesn't.
    () =>
      new Set(
        shown.map((k) => k.kind).filter((k) => (recordable || k !== "aloud") && k !== "write" && (phrases || k !== "dictation")),
      ),
  );
  const [stats, setStats] = useState<Stats | undefined>(remembered.stats);

  useEffect(() => {
    if (counted) api.stats().then(setStats, () => undefined);
  }, [counted]);

  const due: Record<MixKind, number> | undefined = stats && {
    meaning: stats.due.meaning,
    aloud: stats.due.speech,
    choice: stats.due.speech,
    write: stats.due.speech,
    listening: stats.due.listening,
    dictation: stats.due.listening,
  };

  function toggle(kind: MixKind) {
    setKinds((current) => {
      const next = new Set(current);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });
  }

  return (
    <>
      <div className="review-stage mix-stage">
        <section className="mix-setup" aria-labelledby="mix-title">
          <h1 id="mix-title" className="mix-title">
            What to mix
          </h1>
          <div className="mix-options">
            {shown.map(({ kind, title, sub, icon }, i) => {
              const off = kind === "aloud" && !recordable;
              return (
                <button
                  key={kind}
                  type="button"
                  className="mix-option"
                  aria-pressed={kinds.has(kind)}
                  disabled={off}
                  style={{ "--i": i } as CSSProperties}
                  onClick={() => toggle(kind)}
                >
                  <span className="practice-icon">{icon}</span>
                  <span className="practice-text">
                    <span className="practice-title">
                      {title}
                      {counted && due && <span className="mix-count">{due[kind]}</span>}
                    </span>
                    <span className="practice-sub">{off ? "Recording isn't available here" : sub}</span>
                  </span>
                  <span className="mix-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                </button>
              );
            })}
          </div>
          {(["aloud", "choice", "write"] as const).filter((k) => kinds.has(k)).length > 1 && (
            <p className="muted small">Words for speaking are split evenly between the ways you pick.</p>
          )}
        </section>
      </div>
      <footer className="review-actions">
        <button type="button" className="button primary" disabled={!kinds.size} onClick={() => onStart(kinds)}>
          Start
        </button>
      </footer>
    </>
  );
}
