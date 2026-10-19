import { intonationVerdict, type Contour } from "../lib/intonation";
import type { IntonationState } from "../lib/practice";
import { Spinner } from "./Spinner";
import "./practice.css";

const WIDTH = 320;
const HEIGHT = 112;
const PAD = 10;
// Semitones from the speaker's own middle; a learner rarely goes past a sixth either way.
const RANGE = 9;

function path(contour: Contour): string {
  const x = (i: number) => PAD + ((WIDTH - 2 * PAD) * i) / Math.max(contour.length - 1, 1);
  const y = (v: number) => HEIGHT / 2 - (Math.max(-RANGE, Math.min(RANGE, v)) / RANGE) * (HEIGHT / 2 - PAD);
  let d = "";
  let open = false;
  contour.forEach((v, i) => {
    if (v === null) {
      open = false;
      return;
    }
    d += `${open ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    open = true;
  });
  return d;
}

/** The reference's melody and yours on one timeline, with the stretches that part highlighted. */
export function IntonationChart({ state, compact = false }: { state: IntonationState | undefined; compact?: boolean }) {
  if (!state) return null;
  if (state.status === "unavailable") {
    return <p className="intonation-note muted small">Мелодию покажу, когда сервер озвучит образец.</p>;
  }
  if (state.status === "working") {
    return (
      <div className="intonation is-working" aria-busy="true">
        <Spinner />
        <span className="muted small">Сравниваю мелодию…</span>
      </div>
    );
  }
  const { comparison } = state;
  const verdict = intonationVerdict(comparison);
  const frames = comparison.reference.length;
  const x = (i: number) => PAD + ((WIDTH - 2 * PAD) * i) / Math.max(frames - 1, 1);
  return (
    <figure className={`intonation${compact ? " is-compact" : ""}`}>
      <figcaption className={`intonation-title tone-${verdict.tone}`}>{verdict.title}</figcaption>
      <svg
        className="intonation-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Мелодия образца и твоя. ${verdict.title}.`}
      >
        {comparison.diverging.map(([from, to]) => (
          <rect key={from} className="intonation-apart" x={x(from)} y={4} width={Math.max(x(to) - x(from), 2)} height={HEIGHT - 8} rx={6} />
        ))}
        <line className="intonation-mid" x1={PAD} x2={WIDTH - PAD} y1={HEIGHT / 2} y2={HEIGHT / 2} />
        <path className="intonation-reference" d={path(comparison.reference)} />
        <path className="intonation-yours" d={path(comparison.yours)} />
      </svg>
      <div className="intonation-foot">
        <span className="intonation-legend" aria-hidden="true">
          <span className="is-reference">Образец</span>
          <span className="is-yours">Ты</span>
        </span>
        {!compact && <p className="intonation-text muted small">{verdict.text}</p>}
      </div>
    </figure>
  );
}
