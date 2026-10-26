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
    title: "Перевод",
    sub: "Корейское слово → вспомнить перевод",
    icon: <CardsIcon />,
  },
  {
    kind: "aloud",
    title: "Вслух",
    sub: "Перевод → сказать по-корейски",
    icon: <MicIcon />,
  },
  {
    kind: "choice",
    title: "Выбор из вариантов",
    sub: "Перевод → найти слово среди похожих",
    icon: <ChoiceIcon />,
  },
  {
    kind: "write",
    title: "Написать по переводу",
    sub: "Перевод → набрать хангылем",
    icon: <PenIcon />,
  },
  {
    kind: "listening",
    title: "На слух",
    sub: "Послушать → вспомнить перевод",
    icon: <HeadphonesIcon />,
  },
  {
    kind: "dictation",
    title: "Написать по звуку",
    sub: "Послушать → набрать хангылем",
    icon: <EarIcon />,
  },
];

/**
 * What goes into a mixed session, picked before it starts; everything but typing by default. Saying aloud,
 * picking and typing by translation all go through the speech schedule, so they share one count;
 * typing by ear shares the listening one.
 */
export function MixSetup({ counted, onStart }: { counted: boolean; onStart: (kinds: ReadonlySet<MixKind>) => void }) {
  const recordable = canRecord();
  const [kinds, setKinds] = useState<ReadonlySet<MixKind>>(
    // Typing takes the keyboard out, so it joins only when picked.
    () => new Set(KINDS.map((k) => k.kind).filter((k) => (recordable || k !== "aloud") && k !== "write" && k !== "dictation")),
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
            Что смешать
          </h1>
          <div className="mix-options">
            {KINDS.map(({ kind, title, sub, icon }, i) => {
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
                    <span className="practice-sub">{off ? "Запись здесь недоступна" : sub}</span>
                  </span>
                  <span className="mix-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                </button>
              );
            })}
          </div>
          {(["aloud", "choice", "write"] as const).filter((k) => kinds.has(k)).length > 1 && (
            <p className="muted small">Слова «вслух» делятся между выбранными способами поровну.</p>
          )}
        </section>
      </div>
      <footer className="review-actions">
        <button type="button" className="button primary" disabled={!kinds.size} onClick={() => onStart(kinds)}>
          Начать
        </button>
      </footer>
    </>
  );
}
