// Client for services/scorer (services/scorer/README.md). The scorer listens on 127.0.0.1 only;
// the API forwards recordings to it after the session check and rate limit.

export type SyllableStatus = "ok" | "weak" | "wrong";

export type ScoredSyllable = { text: string; pron: string; status: SyllableStatus };

export type Sound = { ipa: string; jamo: string };

export type ScoredError = {
  syllable: number;
  position: string;
  kind: "substitution" | "deletion" | "insertion" | "unclear";
  status: Exclude<SyllableStatus, "ok">;
  expected?: Sound | null;
  heard?: Sound | null;
};

export type ScoreResult = {
  score: number;
  text: string;
  pronunciation: string;
  syllables: ScoredSyllable[];
  errors: ScoredError[];
  target_phones: string[];
  heard_phones: string[];
};

/** Why scoring failed, in terms the web app can explain. */
export type ScorerFailure = "bad_recording" | "busy" | "timeout" | "unavailable";

export class ScorerError extends Error {
  constructor(
    readonly reason: ScorerFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface Scorer {
  score(wav: Uint8Array, text: string): Promise<ScoreResult>;
}

// The scorer gives up after 15 s; a little more here so its own 504 arrives first.
const TIMEOUT_MS = 20_000;

export function httpScorer(baseUrl: string, fetchImpl: typeof fetch = fetch): Scorer {
  return {
    async score(wav, text) {
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/score?text=${encodeURIComponent(text)}`, {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: wav as Uint8Array<ArrayBuffer>,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") throw new ScorerError("timeout", "scorer timed out");
        throw new ScorerError("unavailable", `scorer unreachable: ${(error as Error).message}`);
      }
      if (res.ok) return (await res.json()) as ScoreResult;
      const detail = await res
        .json()
        .then((body: { detail?: unknown }) => String(body.detail ?? ""))
        .catch(() => "");
      if (res.status === 422 || res.status === 413) throw new ScorerError("bad_recording", detail || "bad recording");
      if (res.status === 504) throw new ScorerError("timeout", detail || "scorer timed out");
      if (res.status === 503 && detail === "scorer is busy") throw new ScorerError("busy", detail);
      throw new ScorerError("unavailable", detail || `scorer answered ${res.status}`);
    },
  };
}
