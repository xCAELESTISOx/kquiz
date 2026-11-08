import { useEffect, useState } from "react";
import { api, remembered } from "../lib/api";
import type { FsrsModeStatus, FsrsStatus, ReviewMode } from "../lib/types";

const RETENTIONS = [0.85, 0.9, 0.95];
const MODE_LABEL: Record<ReviewMode, string> = { meaning: "Meaning", speech: "Aloud", listening: "Listening" };
const percent = (r: number) => `${Math.round(r * 100)} %`;

/** Target retention per mode, and whether intervals are already fitted to the owner's history. */
export function ScheduleSettings() {
  const [status, setStatus] = useState<FsrsStatus | undefined>(remembered.fsrs);
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

  // One number when every mode shares it, which is the usual case; otherwise each mode by name.
  const targets = status.modes.map((m) => m.desiredRetention);
  const summary = targets.every((r) => r === targets[0])
    ? `remember ${percent(targets[0]!)}`
    : status.modes.map((m) => `${MODE_LABEL[m.mode].toLowerCase()} ${percent(m.desiredRetention)}`).join(", ");

  return (
    <details className="schedule">
      <summary>
        <span>Schedule</span>
        <span className="muted">{summary}</span>
      </summary>
      <p className="small muted">
        How many words to still remember when a review comes up. Lower means fewer reviews, but more forgotten.
      </p>
      {status.modes.map((m) => (
        <div className="schedule-mode" key={m.mode}>
          <div className="schedule-mode-head">
            <span>{MODE_LABEL[m.mode]}</span>
            <div className="retention-picker" role="group" aria-label={`Target retention: ${MODE_LABEL[m.mode]}`}>
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
      {error && <p className="notice notice-error">Not saved: {error}</p>}
    </details>
  );
}

function fitNote(m: FsrsModeStatus): string {
  if (m.personal && m.optimizedAt) {
    const date = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long" }).format(new Date(m.optimizedAt));
    return `Intervals fitted to you from ${m.trainedOnReviews} grades (${date}). Refitted once a month.`;
  }
  const left = Math.max(m.minReviews - m.reviews, 0);
  return left > 0
    ? `Standard FSRS intervals. They will be fitted to you after ${m.minReviews} grades: ${left} to go.`
    : "Enough grades now: the intervals will be fitted to you within a few hours.";
}
