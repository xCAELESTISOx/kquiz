import type { MixKind, QueueItem, ReviewMode } from "./types";

/**
 * How each item of a mixed session is asked. Several ways can share a schedule (speech: say it, pick
 * it, type it; listening: recall the meaning, type what's heard), so each item takes one of the
 * picked ways at random. An item none of them can do here (nothing to record with, no look-alikes)
 * waits for a better day.
 */
export function mixWays(
  items: QueueItem[],
  kinds: ReadonlySet<MixKind>,
  can: { record: boolean; pick: (item: QueueItem) => boolean },
  random = Math.random,
): Map<QueueItem, MixKind> {
  const ways = new Map<QueueItem, MixKind>();
  for (const item of items) {
    const options: MixKind[] =
      item.mode === "meaning"
        ? ["meaning"]
        : item.mode === "speech"
          ? [
              ...(kinds.has("aloud") && can.record ? (["aloud"] as const) : []),
              ...(kinds.has("choice") && can.pick(item) ? (["choice"] as const) : []),
              ...(kinds.has("write") ? (["write"] as const) : []),
            ]
          : [...(kinds.has("listening") ? (["listening"] as const) : []), ...(kinds.has("dictation") ? (["dictation"] as const) : [])];
    if (options.length) ways.set(item, options[Math.floor(random() * options.length)]!);
  }
  return ways;
}

/** The schedules the picked ways go through. */
export function serverModes(kinds: ReadonlySet<MixKind>): ReviewMode[] {
  const modes: ReviewMode[] = [];
  if (kinds.has("meaning")) modes.push("meaning");
  if (kinds.has("aloud") || kinds.has("choice") || kinds.has("write")) modes.push("speech");
  if (kinds.has("listening") || kinds.has("dictation")) modes.push("listening");
  return modes;
}

/** "Review" a group: every way at once. Only phrases have no speech schedule, so none of its ways. */
export function everyKind(phrases = false): ReadonlySet<MixKind> {
  return new Set<MixKind>(phrases ? ["meaning", "listening", "dictation"] : ["meaning", "aloud", "choice", "write", "listening", "dictation"]);
}
