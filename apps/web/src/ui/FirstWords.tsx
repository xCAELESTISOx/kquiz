import type { CSSProperties } from "react";
import { ChevronIcon } from "./practiceIcons";
import "./first-words.css";
import "./practice.css";

// Placeholder words for the empty wall: they show where the queue will be, never read as real cards.
const GHOSTS = ["안녕하세요", "학교", "감사합니다", "물", "친구", "사랑", "오늘", "먹다", "공부"];

const ADD_MODE_KEY = "kquiz.addMode";

function pickMode(mode: "single" | "bulk") {
  try {
    localStorage.setItem(ADD_MODE_KEY, mode);
  } catch {
    // The add screen falls back to one card.
  }
}

/** Today before the first card: what will appear here, and the ways to get words in. */
export function FirstWords() {
  return (
    <section className="first-words" aria-labelledby="first-words-title">
      <div className="first-words-wall" aria-hidden="true" lang="ko">
        {GHOSTS.map((word, i) => (
          <span key={word} style={{ "--i": i } as CSSProperties}>
            {word}
          </span>
        ))}
      </div>

      <div className="first-words-intro">
        <h2 id="first-words-title" className="first-words-title" lang="ko">
          첫 단어
        </h2>
        <p className="first-words-text">
          Слов пока нет. Добавьте первые, и здесь каждый день будет очередь на повторение.
        </p>
      </div>

      <nav className="practice-links first-words-ways" aria-label="Как добавить слова">
        <a href="#/add" onClick={() => pickMode("single")} style={{ "--i": 0 } as CSSProperties}>
          <span className="practice-icon">
            <PenIcon />
          </span>
          <span className="practice-text">
            <span className="practice-title">По одному</span>
            <span className="practice-sub">Слово, перевод и пример</span>
          </span>
          <ChevronIcon />
        </a>
        <a href="#/add" onClick={() => pickMode("bulk")} style={{ "--i": 1 } as CSSProperties}>
          <span className="practice-icon">
            <ListIcon />
          </span>
          <span className="practice-text">
            <span className="practice-title">Списком</span>
            <span className="practice-sub">Вставить сразу много строк</span>
          </span>
          <ChevronIcon />
        </a>
        <a href="https://claude.ai/new" target="_blank" rel="noreferrer" style={{ "--i": 2 } as CSSProperties}>
          <span className="practice-icon">
            <SparkIcon />
          </span>
          <span className="practice-text">
            <span className="practice-title">Попросить Claude</span>
            <span className="practice-sub">«Добавь в KQuiz 10 слов про еду»</span>
          </span>
          <ChevronIcon />
        </a>
      </nav>
    </section>
  );
}

const icon = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const PenIcon = () => (
  <svg {...icon}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
);

const ListIcon = () => (
  <svg {...icon}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth={3} />
  </svg>
);

const SparkIcon = () => (
  <svg {...icon}>
    <path d="M12 3.5c.6 4.4 2.6 6.9 8.5 8.5-5.9 1.6-7.9 4.1-8.5 8.5-.6-4.4-2.6-6.9-8.5-8.5 5.9-1.6 7.9-4.1 8.5-8.5Z" />
  </svg>
);
