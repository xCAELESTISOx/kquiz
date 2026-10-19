import { Hono } from "hono";
import { z } from "zod";
import { recordAttempt } from "../attemptStore.js";
import type { AuthVariables } from "../auth/sessions.js";
import { getCard } from "../cardStore.js";
import type { Db } from "../db/client.js";
import { suggestSpeechRating } from "../review.js";
import { ScorerError, type Scorer, type ScorerFailure } from "../scorer.js";
import { clientIp, limits, rateLimit } from "../security/rateLimit.js";

// docs/PLAN.md §7: 10 s of 16 kHz mono 16-bit PCM is 320 KB, so 1 MB leaves room for 48 kHz from other clients.
export const MAX_RECORDING_BYTES = 1_000_000;

const STATUS: Record<ScorerFailure, 422 | 503 | 504> = {
  bad_recording: 422,
  busy: 503,
  timeout: 504,
  unavailable: 503,
};

/** POST /api/score?cardId=: the body is the recording as WAV; the result is not a review, the user rates it next. */
export function scoreRoutes(db: Db, scorer: Scorer, now: () => Date) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.post("/", rateLimit({ ...limits.score, key: (c) => clientIp(c), now: () => now().getTime() }), async (c) => {
    const query = z.object({ cardId: z.coerce.number().int().positive() }).safeParse(c.req.query());
    if (!query.success) return c.json({ error: "invalid_request", issues: query.error.issues }, 400);
    const card = getCard(db, query.data.cardId);
    if (!card) return c.json({ error: "not_found" }, 404);
    if (!card.readyForSpeech) return c.json({ error: "not_ready_for_speech" }, 422);

    const wav = new Uint8Array(await c.req.arrayBuffer());
    if (wav.byteLength > MAX_RECORDING_BYTES) return c.json({ error: "payload_too_large" }, 413);
    // "RIFF....WAVE": anything else would only waste a trip to the scorer.
    if (wav.byteLength < 44 || ascii(wav, 0, 4) !== "RIFF" || ascii(wav, 8, 12) !== "WAVE") {
      return c.json({ error: "bad_recording", detail: "not a WAV file" }, 422);
    }

    let result;
    try {
      result = await scorer.score(wav, card.korean);
    } catch (error) {
      if (!(error instanceof ScorerError)) throw error;
      if (error.reason !== "bad_recording") console.error(`scorer: ${error.message}`);
      if (error.reason === "busy") c.header("Retry-After", "5");
      return c.json({ error: error.reason, detail: error.message }, STATUS[error.reason]);
    }

    const attemptId = recordAttempt(db, card.id, result, now());
    return c.json({
      attemptId,
      cardId: card.id,
      score: result.score,
      pronunciation: result.pronunciation,
      syllables: result.syllables,
      errors: result.errors,
      suggestedRating: suggestSpeechRating(
        result.score,
        result.syllables.map((s) => s.status),
      ),
    });
  });

  return app;
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}
