import type { ReactNode } from "react";

/** An empty list says so in Korean first, large and quiet, then tells what to do in Russian. */
export function EmptyState({ word, children }: { word: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state-word" lang="ko">
        {word}
      </p>
      <p className="empty-state-text">{children}</p>
    </div>
  );
}
