import { useEffect, useState } from "react";
import { api } from "./api";
import type { ReviewMode } from "./types";

/** Ids of the hard cards in a mode, to mark them during a review. Best effort: no mark if it fails. */
export function useLeechIds(mode: ReviewMode): ReadonlySet<number> {
  const [ids, setIds] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    api.leeches().then(
      ({ items }) => setIds(new Set(items.filter((l) => l.forgotten[mode]).map((l) => l.card.id))),
      () => {},
    );
  }, [mode]);
  return ids;
}
