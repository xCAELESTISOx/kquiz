import type { MixKind, QueueItem, ReviewMode, Skill, WordSkills } from "./types";

/** What each way of asking trains, as the stats count it (apps/api taskStats.ts). */
const SKILL_OF: Record<MixKind, Skill> = {
  meaning: "recall",
  aloud: "speak",
  choice: "choose",
  write: "write",
  listening: "listen",
  dictation: "dictation",
};
/** A word answered fewer times than this in its ways is asked as any other word. */
export const MIN_WORD_ANSWERS = 3;
// A way the word hasn't been asked yet counts as missed about one time in six, and no way drops
// below one chance in ten of the weakest's: strong ways come up less, never not at all.
const PRIOR_MISSED = 0.5;
const PRIOR_ANSWERS = 3;
const FLOOR = 0.1;

/**
 * How likely each way is for this word: in proportion to how often it goes wrong that way, from
 * its own answers (fresh ones weigh more). Undefined without enough answers to tell.
 */
export function weakWays(options: readonly MixKind[], skills: WordSkills | undefined): Map<MixKind, number> | undefined {
  if (options.length < 2 || !skills) return undefined;
  const tally = options.map((o) => skills[SKILL_OF[o]] ?? { answers: 0, missed: 0 });
  if (tally.reduce((n, t) => n + t.answers, 0) < MIN_WORD_ANSWERS) return undefined;
  const rates = tally.map((t) => (t.missed + PRIOR_MISSED) / (t.answers + PRIOR_ANSWERS));
  const top = Math.max(...rates);
  return new Map(options.map((o, i) => [o, Math.max(rates[i]!, top * FLOOR)]));
}

/**
 * How each item of a mixed session is asked. Several ways can share a schedule (speech: say it, pick
 * it, type it; listening: recall the meaning, type what's heard), so each item takes the picked way
 * used least so far (`already`: the tasks the session has anyway, such as new words written from
 * their translation), at random between equals. A word with answers enough (`skillsOf`) is asked
 * instead by chance in proportion to how often each way goes wrong for it (weakWays). Left to chance alone, a session could run as one
 * way over and over. An item none of them can do here (nothing to record with, no look-alikes)
 * waits for a better day.
 */
export function mixWays(
  items: QueueItem[],
  kinds: ReadonlySet<MixKind>,
  can: { record: boolean; pick: (item: QueueItem) => boolean },
  random = Math.random,
  already: readonly MixKind[] = [],
  skillsOf: (item: QueueItem) => WordSkills | undefined = () => undefined,
): Map<QueueItem, MixKind> {
  const ways = new Map<QueueItem, MixKind>();
  const used = new Map<MixKind, number>();
  for (const kind of already) used.set(kind, (used.get(kind) ?? 0) + 1);
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
    if (!options.length) continue;
    // A word with answers enough is asked more often the way it goes worst for it.
    const weights = weakWays(options, skillsOf(item));
    if (weights) {
      const way = pickWeighted(weights, random);
      ways.set(item, way);
      used.set(way, (used.get(way) ?? 0) + 1);
      continue;
    }
    const least = Math.min(...options.map((o) => used.get(o) ?? 0));
    const fewest = options.filter((o) => (used.get(o) ?? 0) === least);
    const way = fewest[Math.floor(random() * fewest.length)]!;
    ways.set(item, way);
    used.set(way, least + 1);
  }
  return ways;
}

function pickWeighted(weights: Map<MixKind, number>, random: () => number): MixKind {
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  let left = random() * total;
  for (const [way, w] of weights) if ((left -= w) < 0) return way;
  return [...weights.keys()].at(-1)!;
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
