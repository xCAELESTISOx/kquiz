import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { FsrsModeStatus, FsrsStatus, ReviewMode } from "../lib/types";

const RETENTIONS = [0.85, 0.9, 0.95];
const MODE_LABEL: Record<ReviewMode, string> = { meaning: "Значение", speech: "Вслух", listening: "На слух" };
const percent = (r: number) => `${Math.round(r * 100)} %`;

/** Target retention per mode, and whether intervals are already fitted to the owner's history. */
export function ScheduleSettings() {
  const [status, setStatus] = useState<FsrsStatus>();
  const [saving, setSaving] = useState<ReviewMode>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.fsrs().then(setStatus, () => undefined);
  }, []);

  if (!status) return null;

  async function choose(mode: ReviewMode, retention: number) {
    setSaving(mode);
    setError(undefined);
    try {
      setStatus(await api.setRetention(mode, retention));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(undefined);
    }
  }

  const summary = status.modes.map((m) => percent(m.desiredRetention)).join(" · ");

  return (
    <details className="schedule">
      <summary>
        <span>Расписание</span>
        <span className="muted">{summary}</span>
      </summary>
      <p className="small muted">
        Какую долю слов помнить к моменту повторения. Меньше — реже повторы, но больше забытого.
      </p>
      {status.modes.map((m) => (
        <div className="schedule-mode" key={m.mode}>
          <div className="schedule-mode-head">
            <span>{MODE_LABEL[m.mode]}</span>
            <div className="retention-picker" role="group" aria-label={`Запоминаемость: ${MODE_LABEL[m.mode]}`}>
              {RETENTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={Math.abs(m.desiredRetention - r) < 0.001}
                  disabled={saving === m.mode}
                  onClick={() => void choose(m.mode, r)}
                >
                  {percent(r)}
                </button>
              ))}
            </div>
          </div>
          <p className="small muted">{fitNote(m)}</p>
        </div>
      ))}
      {error && <p className="notice notice-error">Не сохранилось: {error}</p>}
    </details>
  );
}

function fitNote(m: FsrsModeStatus): string {
  if (m.personal && m.optimizedAt) {
    const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(m.optimizedAt));
    return `Интервалы подстроены под тебя по ${m.trainedOnReviews} оценкам (${date}). Пересчёт раз в месяц.`;
  }
  const left = Math.max(m.minReviews - m.reviews, 0);
  return left > 0
    ? `Стандартные интервалы FSRS. Подстрою под тебя после ${m.minReviews} оценок: осталось ${left}.`
    : "Оценок уже достаточно: интервалы подстроятся под тебя в ближайшие часы.";
}
