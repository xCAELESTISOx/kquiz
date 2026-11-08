import { fixHint } from "./fixes";
import type { ScoreResult, Sound, SyllableStatus } from "./types";

export type Segment = { text: string; status?: SyllableStatus; index?: number };

/** Splits the card's text into scored syllables, keeping spaces and punctuation the scorer skips. */
export function segments(korean: string, syllables: ScoreResult["syllables"]): Segment[] {
  const hangul = korean.match(/[가-힣]/g) ?? [];
  if (hangul.length !== syllables.length) return syllables.map((s, index) => ({ text: s.text, status: s.status, index }));
  let k = 0;
  return Array.from(korean, (ch) => {
    if (!/[가-힣]/.test(ch)) return { text: ch };
    const index = k++;
    return { text: ch, status: syllables[index]!.status, index };
  });
}

const POSITION: Record<ScoreResult["errors"][number]["position"], string> = {
  onset: "Initial",
  vowel: "Vowel",
  coda: "Batchim",
  extra: "Extra sound",
};

function sound(s: Sound | null | undefined): string {
  if (!s) return "?";
  return s.ipa ? `${s.jamo} [${s.ipa}]` : s.jamo;
}

/** `fix` says how to say the sound right; only wrong sounds get one, weak ones are not mistakes. */
export type ErrorLine = { syllable: string; status: "weak" | "wrong"; label: string; detail: string; fix?: string };

export function describeErrors(result: ScoreResult): ErrorLine[] {
  // Wrong sounds first: those are the ones worth fixing.
  return [...result.errors]
    .sort((a, b) => (a.status === b.status ? a.syllable - b.syllable : a.status === "wrong" ? -1 : 1))
    .map((e) => {
      const detail =
        e.kind === "substitution"
          ? `expected ${sound(e.expected)}, heard ${sound(e.heard)}`
          : e.kind === "deletion"
            ? `${sound(e.expected)} is missing`
            : e.kind === "insertion"
              ? `extra ${sound(e.heard)}`
              : `${sound(e.expected)} sounds unsure`;
      const fix = e.status === "wrong" ? fixHint(e) : undefined;
      return {
        syllable: result.syllables[e.syllable]?.text ?? "",
        status: e.status,
        label: POSITION[e.position],
        detail,
        ...(fix && { fix }),
      };
    });
}

/** Headline for the result. Forgiving: weak syllables are mentioned, never treated as mistakes. */
export function verdict(result: ScoreResult): { title: string; text: string; tone: "ok" | "weak" | "wrong" } {
  const weak = result.syllables.some((s) => s.status === "weak");
  switch (result.suggestedRating) {
    case "easy":
      return { title: "Clean", text: "Every sound is in place.", tone: "ok" };
    case "good":
      return weak
        ? { title: "Good", text: "A couple of sounds are borderline. That's not a mistake, the model is often cautious.", tone: "ok" }
        : { title: "Good", text: "Every sound is in place.", tone: "ok" };
    case "hard":
      return { title: "Almost", text: "One sound drifted off. Listen to the sample and compare.", tone: "weak" };
    case "again":
      return { title: "Not yet", text: "Listen to the sample and try again.", tone: "wrong" };
  }
}
