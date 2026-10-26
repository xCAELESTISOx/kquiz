import { useEffect, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { api, remembered } from "../lib/api";
import type { StatsOverview } from "../lib/types";
import "./Stats.css";

// Modes in a fixed order with fixed colors (checked for color blindness against --bg); a mode the
// server adds later gets the next color and its own name until it is labelled here.
const MODES: { mode: string; label: string }[] = [
  { mode: "meaning", label: "Значение" },
  { mode: "speech", label: "Произношение" },
  { mode: "listening", label: "На слух" },
];
const SERIES_COLORS = ["#6b7cf5", "#2fa992", "#b47d28"];

// IPA of services/scorer's phone inventory → the letter the owner knows.
const JAMO: Record<string, string> = {
  k: "ㄱ", kʰ: "ㅋ", "k͈": "ㄲ", t: "ㄷ", tʰ: "ㅌ", "t͈": "ㄸ", p: "ㅂ", pʰ: "ㅍ", "p͈": "ㅃ",
  tɕ: "ㅈ", tɕʰ: "ㅊ", "t͈ɕ": "ㅉ", s: "ㅅ", "s͈": "ㅆ", h: "ㅎ", m: "ㅁ", n: "ㄴ", ŋ: "ㅇ", l: "ㄹ",
  a: "ㅏ", ʌ: "ㅓ", o: "ㅗ", u: "ㅜ", ɯ: "ㅡ", i: "ㅣ", e: "ㅔ/ㅐ", ja: "ㅑ", je: "ㅖ", jʌ: "ㅕ", jo: "ㅛ",
  ju: "ㅠ", wa: "ㅘ", we: "ㅚ", wʌ: "ㅝ", wi: "ㅟ", ɰi: "ㅢ",
}; // prettier-ignore

/** Below this many reviews a percentage says more about luck than memory. */
const MIN_RETENTION_REVIEWS = 20;
const MIN_TREND_ATTEMPTS = 3;

export function StatsScreen() {
  const [stats, setStats] = useState<StatsOverview | undefined>(remembered.statsOverview);
  const [error, setError] = useState<string>();

  useEffect(() => {
    document.title = "Статистика · KQuiz";
    api.statsOverview().then(setStats, (e: Error) => setError(e.message));
  }, []);

  const modes = stats ? modeList(stats) : [];

  return (
    <main className="screen stats">
      <header className="screen-header">
        <h1 className="title" lang="ko">
          통계
        </h1>
        <p className="subtitle">статистика</p>
      </header>

      {error && <p className="notice notice-error">Не получилось загрузить статистику: {error}. Обнови страницу.</p>}
      {!stats && !error && (
        <div className="stats-loading" aria-busy="true">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      {stats && (
        <>
          <Streak stats={stats} />
          <Section i={1} title="Прогноз повторений">
            <Forecast stats={stats} modes={modes} />
          </Section>
          <Section i={2} title="Запоминание" aside="за 30 дней">
            <Retention stats={stats} modes={modes} />
          </Section>
          <Section i={3} title="Активность" aside={`${sum(stats.activity.map((a) => a.reviews))} за 17 недель`}>
            <Activity stats={stats} />
          </Section>
          <Section i={4} title="Карточки" aside={`всего ${stats.cards.total}`}>
            <CardStates stats={stats} modes={modes} />
          </Section>
          <Section i={5} title="Произношение">
            <SpeechTrend stats={stats} />
            <WeakSounds stats={stats} />
          </Section>
        </>
      )}
    </main>
  );
}

type Mode = { mode: string; label: string; color: string };

function modeList(stats: StatsOverview): Mode[] {
  const present = new Set([...Object.keys(stats.cards.byMode), ...Object.keys(stats.forecast[0]?.due ?? {})]);
  const known = MODES.filter((m) => present.has(m.mode));
  const extra = [...present].filter((m) => !MODES.some((k) => k.mode === m)).map((mode) => ({ mode, label: mode }));
  return [...known, ...extra].slice(0, SERIES_COLORS.length).map((m, i) => ({ ...m, color: SERIES_COLORS[i]! }));
}

function Section({ title, aside, i, children }: { title: string; aside?: ReactNode; i: number; children: ReactNode }) {
  return (
    <section className="stats-section" style={{ "--i": i } as CSSProperties} aria-label={title}>
      <header className="stats-section-head">
        <h2>{title}</h2>
        {aside && <span className="stats-aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

function Streak({ stats }: { stats: StatsOverview }) {
  const { current, best, reviewedToday } = stats.streak;
  let note: string;
  if (current === 0) note = best ? `Рекорд — ${best} ${days(best)}. Новая серия начнётся с первого повторения.` : "Серия начнётся с первого повторения.";
  else if (!reviewedToday) note = "Сегодня ещё не было повторений: одно занятие сохранит серию.";
  else if (current >= best) note = "Это твой рекорд.";
  else note = `Рекорд — ${best} ${days(best)}.`;
  return (
    <section className="streak" aria-label="Серия">
      <p className="streak-number" data-alive={current === 0 ? undefined : reviewedToday ? "today" : "pending"}>
        {current}
      </p>
      <div>
        <p className="streak-label">{days(current)} подряд</p>
        <p className="muted">{note}</p>
      </div>
    </section>
  );
}

function Forecast({ stats, modes }: { stats: StatsOverview; modes: Mode[] }) {
  const [range, setRange] = useState<7 | 30>(7);
  const items = stats.forecast.slice(0, range);
  const totals = items.map((f) => sum(modes.map((m) => f.due[m.mode] ?? 0)));
  const max = Math.max(...totals, 1);
  const [selected, select] = useState<number>();
  const pick = usePointerPick(items.length, select);

  const peak = totals.indexOf(Math.max(...totals));
  const shown = selected ?? 1;
  const day = items[shown];

  return (
    <>
      <div className="segmented segmented-small" role="tablist" aria-label="Период" data-mode={range === 30 ? "bulk" : "single"}>
        {([7, 30] as const).map((r) => (
          <button key={r} role="tab" aria-selected={range === r} onClick={() => (setRange(r), select(undefined))}>
            {r} дней
          </button>
        ))}
      </div>

      <div className="readout" aria-live="polite">
        {day && (
          <>
            <span className="readout-value">{totals[shown]}</span>
            <span className="readout-label">{dayName(day.day, shown)}</span>
            {modes.length > 1 && (
              <span className="readout-parts">
                {modes.map((m) => (
                  <span key={m.mode}>
                    <i style={{ background: m.color }} />
                    {day.due[m.mode] ?? 0}
                  </span>
                ))}
              </span>
            )}
          </>
        )}
      </div>

      <div
        className="bars"
        data-range={range}
        data-picking={selected !== undefined}
        role="img"
        aria-label={`Повторений по дням: ${items.map((f, i) => `${shortDate(f.day)} — ${totals[i]}`).join(", ")}`}
        {...pick}
      >
        {items.map((f, i) => (
          <div key={f.day} className="bar" data-selected={i === selected} data-today={i === 0}>
            <div className="bar-stack" style={{ height: `${(totals[i]! / max) * 100}%` }}>
              {modes.map((m) =>
                f.due[m.mode] ? (
                  <span key={m.mode} style={{ flexGrow: f.due[m.mode], background: m.color }} />
                ) : null,
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="bars-axis" data-range={range} aria-hidden="true">
        {items.map((f, i) => (
          <span key={f.day}>{range === 7 ? weekday(f.day, i) : i % 7 === 0 && i < 28 ? (i === 0 ? "сег." : shortDate(f.day)) : ""}</span>
        ))}
      </div>

      {modes.length > 1 && <Legend modes={modes} />}
      <p className="stats-note">
        {totals[0] ? `Сегодня ${totals[0]}, включая просроченные. ` : ""}
        За {range} дней — {sum(totals)}
        {totals[peak]! > 0 && peak > 0 ? `, больше всего ${dayName(items[peak]!.day, peak).toLowerCase()}: ${totals[peak]}` : ""}.
        Новые карточки сюда не входят.
      </p>
    </>
  );
}

function Retention({ stats, modes }: { stats: StatsOverview; modes: Mode[] }) {
  const targetOf = (mode: string) => Math.round((stats.targetRetention[mode] ?? 0.9) * 100);
  const targets = new Set(modes.map((m) => targetOf(m.mode)));
  return (
    <ul className="retention">
      {modes.map((m) => {
        const r = stats.retention[m.mode] ?? { reviews: 0, recalled: 0 };
        const enough = r.reviews >= MIN_RETENTION_REVIEWS;
        const pct = r.reviews ? Math.round((r.recalled / r.reviews) * 100) : 0;
        const target = targetOf(m.mode);
        return (
          <li key={m.mode}>
            <div className="retention-head">
              <span>{m.label}</span>
              <strong data-faint={!enough}>{r.reviews ? `${pct}%` : "—"}</strong>
            </div>
            <div className="meter" style={{ "--target": `${target}%` } as CSSProperties}>
              <span style={{ width: `${pct}%`, background: m.color, opacity: enough ? 1 : 0.4 }} />
            </div>
            <p className="stats-note">
              {enough
                ? `Вспомнил ${r.recalled} из ${r.reviews}. ${pct >= target - 3 ? (pct > target + 5 ? "Выше цели: интервалы можно растянуть." : "Около цели FSRS.") : "Ниже цели: стоит повторять вовремя."}`
                : r.reviews
                  ? `Пока мало данных: ${r.reviews} из ${MIN_RETENTION_REVIEWS} повторений.`
                  : "Появится после повторений в разные дни."}
            </p>
          </li>
        );
      })}
      <li className="stats-note retention-target">
        <i aria-hidden="true" /> цель FSRS{targets.size === 1 ? ` — ${[...targets][0]}%` : ", своя для каждого режима"}. Первые показы и шаги заучивания не считаются.
      </li>
    </ul>
  );
}

function Activity({ stats }: { stats: StatsOverview }) {
  const days = stats.activity;
  // Columns are weeks from Monday, so a row is always the same weekday.
  const pad = (parseDay(days[0]!.day).getDay() + 6) % 7;
  const max = Math.max(...days.map((d) => d.reviews), 1);
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const columns = Math.ceil((pad + days.length) / 7);
  const [selected, select] = useState<number>();
  const shown = selected ?? days.length - 1;
  const active = days.filter((d) => d.reviews > 0).length;

  // Month names over the first column that starts in that month.
  const months: (string | null)[] = Array.from({ length: columns }, (_, col) => {
    const first = days[Math.max(col * 7 - pad, 0)]!;
    const prev = col > 0 ? days[Math.max((col - 1) * 7 - pad, 0)] : undefined;
    const date = parseDay(first.day);
    if (prev && parseDay(prev.day).getMonth() === date.getMonth()) return null;
    return col === 0 && date.getDate() > 20 ? null : new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(date).replace(".", "");
  });

  return (
    <>
      <div className="readout" aria-live="polite">
        <span className="readout-value">{days[shown]!.reviews}</span>
        <span className="readout-label">{dayName(days[shown]!.day, shown - days.length + 1)}</span>
      </div>
      <div className="heatmap" style={{ "--cols": columns } as CSSProperties}>
        <div className="heatmap-months" aria-hidden="true">
          {months.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
        <div className="heatmap-grid" role="img" aria-label={`Занимался ${active} из ${days.length} дней`}>
          {Array.from({ length: pad }, (_, i) => (
            <span key={`pad-${i}`} className="heatmap-cell" data-level="none" />
          ))}
          {days.map((d, i) => (
            <span
              key={d.day}
              className="heatmap-cell"
              data-level={level(d.reviews)}
              data-selected={i === selected}
              onPointerEnter={() => select(i)}
              onPointerDown={() => select(i)}
            />
          ))}
        </div>
      </div>
      <div className="heatmap-legend" aria-hidden="true">
        <span>меньше</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="heatmap-cell" data-level={l} />
        ))}
        <span>больше</span>
      </div>
      <p className="stats-note">
        Занимался {active} из {days.length} {daysGenitive(days.length)}.
      </p>
    </>
  );
}

const STATES = [
  { key: "new", label: "Новые" },
  { key: "learning", label: "Учу" },
  { key: "young", label: "Повторяю" },
  { key: "mature", label: "Выучены" },
] as const;

function CardStates({ stats, modes }: { stats: StatsOverview; modes: Mode[] }) {
  return (
    <>
      <ul className="card-states">
        {modes.map((m) => {
          const c = stats.cards.byMode[m.mode];
          if (!c) return null;
          const total = c.new + c.learning + c.young + c.mature;
          return (
            <li key={m.mode}>
              <div className="retention-head">
                <span>{m.label}</span>
                <span className="muted">{total}</span>
              </div>
              <div className="states-bar" role="img" aria-label={STATES.map((s) => `${s.label}: ${c[s.key]}`).join(", ")}>
                {STATES.map((s, i) =>
                  c[s.key] ? <span key={s.key} data-step={i} style={{ flexGrow: c[s.key] }} /> : null,
                )}
              </div>
              <div className="states-values">
                {STATES.map((s, i) => (
                  <span key={s.key}>
                    <i data-step={i} />
                    {s.label} <b>{c[s.key]}</b>
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="stats-note">Выучены — карточки с интервалом от трёх недель.</p>
    </>
  );
}

function SpeechTrend({ stats }: { stats: StatsOverview }) {
  const weeks = stats.speech.weeks;
  const [selected, select] = useState<number>();
  const pick = usePointerPick(weeks.length, select);
  const lastWithData = weeks.map((w) => w.avgScore !== null).lastIndexOf(true);
  if (lastWithData < 0) {
    return <p className="stats-note">Здесь появится средняя оценка по неделям, когда начнёшь тренировать произношение.</p>;
  }
  const shown = selected ?? lastWithData;
  const week = weeks[shown]!;
  return (
    <>
      <div className="readout" aria-live="polite">
        <span className="readout-value">{week.avgScore ?? "—"}</span>
        <span className="readout-label">
          средняя оценка, {weekRange(week.start)}
          {week.attempts ? ` · ${week.attempts} ${plural(week.attempts, "попытка", "попытки", "попыток")}` : ""}
        </span>
      </div>
      <div
        className="bars bars-score"
        data-picking={selected !== undefined}
        role="img"
        aria-label={`Средняя оценка по неделям: ${weeks.map((w) => w.avgScore ?? "нет").join(", ")}`}
        {...pick}
      >
        {weeks.map((w, i) => (
          <div key={w.start} className="bar" data-selected={i === selected} data-empty={w.avgScore === null}>
            <div className="bar-stack" style={{ height: `${w.avgScore ?? 0}%` }}>
              <span style={{ flexGrow: 1, background: SERIES_COLORS[1] }} />
            </div>
          </div>
        ))}
      </div>
      <div className="bars-axis" aria-hidden="true">
        {weeks.map((w, i) => (
          <span key={w.start}>{i === weeks.length - 1 ? "эта" : i % 2 === 1 ? shortDate(w.start) : ""}</span>
        ))}
      </div>
    </>
  );
}

function WeakSounds({ stats }: { stats: StatsOverview }) {
  const sounds = stats.speech.sounds;
  if (!sounds.length) return null;
  return (
    <>
      <h3 className="stats-subhead">Трудные звуки</h3>
      <ul className="sounds">
        {sounds.map((s) => {
          const rate = Math.round((s.errors / s.attempts) * 100);
          const trend = soundTrend(s.recent, s.previous);
          return (
            <li key={s.phone}>
              <span className="sound-glyph" lang="ko">
                {JAMO[s.phone] ?? s.phone}
              </span>
              <div className="sound-body">
                <div className="retention-head">
                  <span>
                    <b>{rate}%</b> <span className="muted">ошибок · [{s.phone}]</span>
                  </span>
                  {trend && (
                    <span className="trend" data-trend={trend.kind}>
                      <TrendArrow kind={trend.kind} />
                      {trend.label}
                    </span>
                  )}
                </div>
                <div className="meter meter-thin">
                  <span style={{ width: `${rate}%` }} />
                </div>
                <p className="stats-note">
                  {s.errors} из {s.attempts}
                  {trend?.detail ? ` · ${trend.detail}` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="stats-note">Сравниваются последние две недели с двумя неделями до них.</p>
    </>
  );
}

type Window = { attempts: number; errors: number };

function soundTrend(recent: Window, previous: Window) {
  if (recent.attempts < MIN_TREND_ATTEMPTS) {
    return { kind: "none" as const, label: "нет данных", detail: "за 2 недели почти не встречался" };
  }
  const now = recent.errors / recent.attempts;
  if (previous.attempts < MIN_TREND_ATTEMPTS) {
    return { kind: "none" as const, label: "новый", detail: `за 2 недели ${Math.round(now * 100)}%` };
  }
  const before = previous.errors / previous.attempts;
  const detail = `было ${Math.round(before * 100)}%, стало ${Math.round(now * 100)}%`;
  if (now <= before - 0.05) return { kind: "better" as const, label: "лучше", detail };
  if (now >= before + 0.05) return { kind: "worse" as const, label: "хуже", detail };
  return { kind: "same" as const, label: "так же", detail };
}

function TrendArrow({ kind }: { kind: "better" | "worse" | "same" | "none" }) {
  if (kind === "none") return null;
  const d = kind === "better" ? "M6 4v8m0 0 3.5-3.5M6 12 2.5 8.5" : kind === "worse" ? "M6 12V4m0 0 3.5 3.5M6 4 2.5 7.5" : "M2 8h8m0 0L7 5m3 3-3 3";
  return (
    <svg width="12" height="16" viewBox="0 0 12 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Legend({ modes }: { modes: Mode[] }) {
  return (
    <div className="legend">
      {modes.map((m) => (
        <span key={m.mode}>
          <i style={{ background: m.color }} />
          {m.label}
        </span>
      ))}
    </div>
  );
}

/** Touch and mouse pick the bar under the finger; leaving the chart clears the pick. */
function usePointerPick(count: number, select: (i: number | undefined) => void) {
  const at = (e: PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * count);
    select(Math.min(Math.max(i, 0), count - 1));
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      at(e);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" || e.buttons) at(e);
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse") select(undefined);
    },
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const days = (n: number) => plural(n, "день", "дня", "дней");
const daysGenitive = (n: number) => plural(n, "дня", "дней", "дней");

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d);
}

const shortDate = (day: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(parseDay(day)).replace(".", "");

function weekday(day: string, offset: number) {
  if (offset === 0) return "сег.";
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(parseDay(day));
}

/** "Сегодня", "Завтра", "Вчера" or "Пн, 27 окт", with `offset` days from today. */
function dayName(day: string, offset: number) {
  if (offset === 0) return "Сегодня";
  if (offset === 1) return "Завтра";
  if (offset === -1) return "Вчера";
  const name = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(parseDay(day));
  return `${name[0]!.toUpperCase()}${name.slice(1)}, ${shortDate(day)}`;
}

function weekRange(start: string) {
  const from = parseDay(start);
  const to = new Date(from);
  to.setDate(to.getDate() + 6);
  const fmt = (d: Date) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(d).replace(".", "");
  return `${fmt(from)} – ${fmt(to)}`;
}
