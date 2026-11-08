import type { CSSProperties } from "react";
import { ChevronIcon, EarIcon, WaveIcon } from "./practiceIcons";
import "./practice.css";

/** Practice outside the review queues, any time: shadowing and the similar-sounds drill. */
export function PracticeLinks() {
  return (
    <nav className="practice-links" aria-label="Practice">
      <a href="#/shadow" style={{ "--i": 0 } as CSSProperties}>
        <span className="practice-icon">
          <WaveIcon />
        </span>
        <span className="practice-text">
          <span className="practice-title">Shadowing</span>
          <span className="practice-sub">Repeat the examples, with the phrase melody</span>
        </span>
        <ChevronIcon />
      </a>
      <a href="#/sounds" style={{ "--i": 1 } as CSSProperties}>
        <span className="practice-icon">
          <EarIcon />
        </span>
        <span className="practice-text">
          <span className="practice-title">Similar sounds</span>
          <span className="practice-sub" lang="ko">
            ㄱ · ㅋ · ㄲ <span>and more, by ear</span>
          </span>
        </span>
        <ChevronIcon />
      </a>
    </nav>
  );
}
